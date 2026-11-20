import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

type Row = { id: string; message: string; route: string; style: string };
type Scored = { row: Row; score: number };
type Configuration = { accents: boolean; corpusFraction: number | null };

const epochs = 40;
const learningRate = 3;
const regularization = 0.002;
const work = (row: Row) => (row.route === 'chat' ? 0 : 1);
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
const knownRoutes = new Set(['chat', 'general', 'handoff', 'review', 'scope', 'mac']);

function features(message: string, accents: boolean) {
  const original = message.normalize('NFKC').toLowerCase();
  const folded = original
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('đ', 'd');
  const terms = new Set<string>();
  for (const text of accents ? [original, folded] : [folded]) {
    const words = text.match(/[\p{L}\p{N}]+/gu) || [];
    for (const [index, word] of words.entries()) {
      terms.add(word);
      if (index) terms.add(words[index - 1] + ' ' + word);
    }
  }
  return [...terms];
}

// Fifty provider/style combinations can share one original corpus sentence.
// Count each original request once when weighting the training rows.
function family({ id }: Row) {
  const [prefix, scenario, , role] = id.split('/');
  return prefix.startsWith('team-') ? 'corpus/' + scenario : [prefix, scenario, role].join('/');
}

function train(rows: Row[], configuration: Configuration) {
  const started = performance.now();
  const sizes = new Map<string, number>();
  for (const row of rows) {
    const key = family(row);
    sizes.set(key, (sizes.get(key) || 0) + 1);
  }
  const vocabulary = new Map<string, number>();
  const samples = rows
    .filter(({ id }) => configuration.corpusFraction !== 0 || !id.startsWith('team-'))
    .map((row) => {
      const indices = features(row.message, configuration.accents).map((term) => {
        if (!vocabulary.has(term)) vocabulary.set(term, vocabulary.size);
        return vocabulary.get(term)!;
      });
      return {
        indices,
        scale: 1 / Math.sqrt(Math.max(indices.length, 1)),
        expected: work(row),
        source: Number(row.id.startsWith('team-')),
        weight: 1 / sizes.get(family(row))!,
      };
    });
  const masses = [
    [0, 0],
    [0, 0],
  ];
  for (const sample of samples) masses[sample.expected][sample.source] += sample.weight;
  const weights = new Float64Array(vocabulary.size);
  let intercept = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = new Float64Array(weights.length);
    let interceptGradient = 0;
    for (const sample of samples) {
      let linear = 0;
      for (const index of sample.indices) linear += weights[index];
      const sourceMass = masses[sample.expected];
      const fraction = configuration.corpusFraction;
      const importance =
        fraction === null
          ? sample.weight / (sourceMass[0] + sourceMass[1])
          : (sample.weight * (sample.source ? fraction : 1 - fraction)) / sourceMass[sample.source];
      const residual =
        ((sample.expected - sigmoid(intercept + linear * sample.scale)) * importance) / 2;
      interceptGradient += residual;
      for (const index of sample.indices) gradient[index] += residual * sample.scale;
    }
    intercept += learningRate * interceptGradient;
    for (let index = 0; index < weights.length; index++)
      weights[index] += learningRate * (gradient[index] - regularization * weights[index]);
  }
  return {
    configuration,
    trainedRows: samples.length,
    coefficients: weights.length,
    trainingMs: performance.now() - started,
    score(message: string) {
      const terms = features(message, configuration.accents);
      let linear = 0;
      for (const term of terms) {
        const index = vocabulary.get(term);
        if (index !== undefined) linear += weights[index];
      }
      return sigmoid(intercept + linear / Math.sqrt(Math.max(terms.length, 1)));
    },
  };
}

function metrics(items: Scored[], suggest: (score: number) => boolean) {
  const matches = new Map<string, boolean[]>();
  const styles: Record<string, { total: number; correct: number }> = {};
  const falseWork: string[] = [];
  const missedWork: string[] = [];
  let correct = 0;
  let suggestions = 0;
  for (const { row, score } of items) {
    const predicted = suggest(score);
    const match = Number(predicted) === work(row);
    suggestions += Number(predicted);
    correct += Number(match);
    if (predicted && !match) falseWork.push(row.id);
    if (!predicted && !match) missedWork.push(row.id);
    const style = (styles[row.style] ??= { total: 0, correct: 0 });
    style.total++;
    style.correct += Number(match);
    const pair = /\/(?:work|chat)$/.test(row.id) ? row.id.replace(/\/(?:work|chat)$/, '') : '';
    if (pair) {
      const verdicts = matches.get(pair) || [];
      verdicts.push(match);
      matches.set(pair, verdicts);
    }
  }
  return {
    total: items.length,
    work: items.filter(({ row }) => work(row)).length,
    chat: items.filter(({ row }) => !work(row)).length,
    correct,
    suggestions,
    falseWork,
    missedWork,
    pairsCorrect: [...matches.values()].filter((pair) => pair.length === 2 && pair.every(Boolean))
      .length,
    pairs: matches.size,
    styles,
  };
}

const directory = process.argv[2];
assert.ok(
  directory,
  'Pass a folder generated by sade-qwen-dataset.ts --contrastive --context-pairs.',
);
const hashes: Record<string, string> = {};
const ids = new Set<string>();
const messages = new Set<string>();
function read(name: string) {
  const file = readFileSync(path.join(directory, name + '.jsonl'), 'utf8');
  hashes[name] = createHash('sha256').update(file).digest('hex');
  const rows: Row[] = file
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  for (const row of rows) {
    assert.ok(
      row.id && row.message && row.style && knownRoutes.has(row.route),
      'Invalid labelled row.',
    );
    assert.ok(!ids.has(row.id) && !messages.has(row.message), 'Data splits must be distinct.');
    ids.add(row.id);
    messages.add(row.message);
  }
  return rows;
}

const training = read('train');
const calibration = read('challenge');
assert.ok(
  calibration.some((row) => !work(row)),
  'Calibration needs chat examples.',
);
const classify = (score: number) => score >= 0.5;
const candidates = [false, true].flatMap((accents) =>
  [null, 0, 0.1, 0.25].map((corpusFraction) => {
    const model = train(training, { accents, corpusFraction });
    const scores = calibration.map((row) => ({ row, score: model.score(row.message) }));
    return { model, scores, result: metrics(scores, classify) };
  }),
);
candidates.sort(
  (a, b) =>
    b.result.pairsCorrect - a.result.pairsCorrect ||
    a.result.falseWork.length - b.result.falseWork.length ||
    a.model.coefficients - b.model.coefficients,
);
const best = candidates[0];
// A suggestion may ask for confirmation. It can never start a workflow.
const suggestionThreshold = Math.max(
  ...best.scores.filter(({ row }) => !work(row)).map(({ score }) => score),
);
const splits = ['holdout', 'acceptance', 'final'].filter((name) =>
  existsSync(path.join(directory, name + '.jsonl')),
);
const evaluations: [string, Row[]][] = splits.map((name) => [name, read(name)]);
if (best.model.configuration.corpusFraction === 0) {
  evaluations.push(['corpus', training.filter(({ id }) => id.startsWith('team-'))]);
}
const results = Object.fromEntries(
  evaluations.map(([name, rows]) => {
    const times: number[] = [];
    const scored = rows.map((row) => {
      const started = performance.now();
      const score = best.model.score(row.message);
      times.push(performance.now() - started);
      return { row, score };
    });
    times.sort((a, b) => a - b);
    return [
      name,
      {
        classification: metrics(scored, classify),
        confirmation: metrics(scored, (score) => score > suggestionThreshold),
        p50Ms: times[Math.ceil(times.length * 0.5) - 1],
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
      },
    ];
  }),
);

const qwenResults = process.argv[3];
let comparison;
if (qwenResults) {
  const final = evaluations.find(([name]) => name === 'final')?.[1];
  assert.ok(final, 'A Qwen comparison needs the independent final split.');
  const qwen: {
    total: number;
    correct: number;
    errors: { id: string; expected: string; predicted: string }[];
  } = JSON.parse(readFileSync(qwenResults, 'utf8'));
  const finalLabels = new Map(final.map((row) => [row.id, work(row) ? 'work' : 'chat']));
  const errors = new Set(qwen.errors.map(({ id }) => id));
  assert.equal(qwen.total, final.length);
  assert.equal(qwen.correct + errors.size, final.length);
  assert.equal(qwen.errors.length, errors.size);
  for (const error of qwen.errors) {
    assert.equal(finalLabels.get(error.id), error.expected);
    assert.ok(['work', 'chat'].includes(error.predicted) && error.predicted !== error.expected);
  }
  const flags = final.map((row) => ({
    row,
    cpu: best.model.score(row.message) > suggestionThreshold,
    qwen: Boolean(work(row)) !== errors.has(row.id),
  }));
  comparison = {
    qwen: metrics(
      flags.map(({ row, qwen }) => ({ row, score: Number(qwen) })),
      classify,
    ),
    simulatedQwenCalls: flags.filter(({ cpu }) => cpu).length,
    combinedConfirmation: metrics(
      flags.map(({ row, cpu, qwen }) => ({ row, score: Number(cpu && qwen) })),
      classify,
    ),
  };
}

console.log(
  JSON.stringify(
    {
      trainingRows: training.length,
      hashes,
      configurations: candidates.map(({ model, result }) => ({
        ...model.configuration,
        coefficients: model.coefficients,
        correct: result.correct,
        pairsCorrect: result.pairsCorrect,
        falseWork: result.falseWork.length,
      })),
      chosen: best.model.configuration,
      trainedRows: best.model.trainedRows,
      coefficients: best.model.coefficients,
      trainingMs: best.model.trainingMs,
      suggestionThreshold,
      calibration: best.result,
      results,
      comparison,
      processPeakRssMiB: process.resourceUsage().maxRSS / 1024,
    },
    null,
    2,
  ),
);
