import type { PlanTask } from '../shared/types.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import { assertSharedHandoffPlan, type SharedDelivery } from './group-sade.ts';
import { normalizeScope, redact, scopesOverlap } from './security.ts';
import { foldSharedSadeName } from './shared-sade-assignment.ts';
import type { SharedSadeCloudResult } from './shared-sade-cloud-planner.ts';
import { frontendStyleQuestion, groundedHandoffStyle } from './shared-sade-handoff-facts.ts';
import { parseTeamPlan } from './workflow-plan.ts';

type Member = SharedDelivery['team'][number];
type Clause = { text: string; words: string; files: string[] };
type Assignment = { member: Member; clause: Clause; file: string };
type Graph = { summary: string; tasks: PlanTask[] };

const fileToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{M}\p{N}_.-]+\/)*[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const useClause =
  /(?<=[.!?;])\s+|[\s,]+(?=(?:(?:rồi|roi|sau đó|sau do|tiếp theo|tiep theo|and then|then) (?:giao|chuyển|chuyen|nhờ|nho|assign|hand|give|ask) |(?:và|va|and) (?:(?:cho|để|de) (?:một |mot )?(?:người khác|nguoi khac)|(?:have|ask) (?:someone else|another (?:person|teammate|engineer))) ))/iu;
const taskVerb =
  'soan|chot|thiet ke|xay dung|dung|lam|sua|chinh sua|viet|tao|cap nhat|trien khai|bo sung|them|prepare|design|draft|set up|build|edit|fix|write|create|update|implement|add';
const checkVerb = 'kiem tra|xac minh|doi chieu|doc|check|verify|inspect|read';
const assignPreamble = /^(?:nho|giao cho|giao|cho|hay|vui long|please|ask|have|let) /u;
const actionAfterActor = new RegExp(
  `^(?:(?:to|should|please) )?(?<verb>${taskVerb}|${checkVerb}) (?<work>.+)$`,
  'u',
);
const writeVerb = new RegExp(`^(?:${taskVerb})$`, 'u');
const backupOrPublication =
  /\b(?:push|deploy|publish|merge|upload|fallback|backup|du phong|het (?:luot|quota|han muc)|xuat ban|dua len|day len|tai len|hop nhanh|gui den|send to|post to)\b/u;
const platform =
  /\b(?:macos|macbook|darwin|mac(?! (?:dinh|du|ke)\b)|windows|win32|linux|ubuntu|debian)\b/u;
const unsafeDirective =
  /\b(?:sau khi (?:duoc )?(?:duyet|xac nhan|dong y)|cho (?:toi |minh )?(?:duyet|xac nhan|bat den xanh)|chua (?:duoc |can )?(?:duyet|sua|giao|lam)|tam (?:dung|hoan)|do not (?:assign|start|write)|hold off|wait for (?:my |their )?(?:approval|sign[ -]?off)|unless|tru khi|neu khong|instead of|thay vi|dinh chinh|correction)\b/u;
const coordinate =
  /^(?:(?:mot |one )?(?:quick |ngan )?(?:handoff|ban giao)(?: (?:nha|nhe|giup toi))?|(?:chia|tach|split) (?:viec|cong viec|work) (?:cho|phan|for) [\p{L}\p{N}-]+(?: [\p{L}\p{N}-]+){0,15}|[\p{L}\p{N} -]{2,75} (?:chia|tach)(?: viec)? giup (?:minh|toi|tui) (?:the nay|nhu sau)(?: (?:nha|nhe))?)$/u;
const parallelIntro =
  /^(?:(?:chia|tach) (?:hai|2) (?:dau )?(?:viec|tac vu) (?:doc lap|song song)(?: cho [\p{L}\p{N} -]{1,45})?|(?:please )?(?:split|assign) (?:this into )?(?:two|2) (?:parallel|independent) (?:tasks|assignments|work items)(?: for [\p{L}\p{N} -]{1,45})?)$/u;
const parallelEnding =
  /^(?:(?:ca )?hai (?:viec|tac vu) (?:co the )?(?:chay|lam) song song(?: duoc)?|(?:both|the two) (?:tasks|changes) (?:can |should )?run in parallel|there(?:['’]s| is) no dependency between (?:these|the) two (?:changes|tasks|assignments))$/u;
const completedTransfer =
  /^(?:(?:co|khi co) (?:ban )?(?:hop dong|contract|cau truc|quy uoc|file do|tep do|brief) (?:roi|xong)[, ]+(?:thi |moi )?|(?:khi )?xong (?:file do|tep do|brief|phan (?:tren|do)) roi (?:moi )?(?:toi |den |chuyen cho )?|(?:sau )?khi (?:file do|tep do|contract|hop dong|brief) (?:xong|hoan tat|hoan thanh)[, ]+(?:thi |moi )?|after (?:that file|the brief|the contract|it) (?:is (?:ready|done|complete)|lands)[, ]+)/u;
const nextTransfer =
  /^(?:roi|sau do|tiep theo|and then|then) (?:(?:chuyen (?:cho|sang)|ban giao cho|hand (?:it )?off to|give (?:it )?to) )?/u;
const contract = /\b(?:contract|hop dong|kien truc|quy uoc|cau truc|architecture|schema)\b/u;
const frontend = /\b(?:frontend|front[ -]end|giao dien|ui|screen)\b/u;
const frontendFile = /\.(?:tsx|jsx|vue|svelte|html|css)$/i;
const supportBackend = /\b(?:backend|back[ -]end|api)\b/u;
const supportTests = /(?:^|\/)(?:tests?|specs?|__tests__)\/|\.(?:test|spec)\.[^/]+$/i;
const parallelSibling = new RegExp(
  `^(?:va (?:cho|de) (?:mot )?nguoi khac (?:${taskVerb}) .+ song song|and (?:have|ask) (?:someone else|another (?:person|teammate|engineer)) (?:to )?(?:${taskVerb}) .+ in parallel)$`,
  'u',
);
const explicitTestOrder =
  /^(?:(?:file|tep|bo test|the file) +)?(?:thi )?(?:(?:doi|cho) (?:phan )?(?:server|backend|api) (?:xong|hoan tat|hoan thanh) (?:moi|roi) (?:viet|them|bo sung)|wait(?:s)? (?:until|for) (?:the )?(?:backend|server|api) (?:is )?(?:done|landed|ready|complete) (?:before|to) (?:write|add))$/u;
const supportAssigned = new RegExp(
  `^(?:(?:sade )?(?:giao|phan cong|assign) |(?:cung )?(?:doi|cho) (?:ban )?(?:hop dong|contract|cau truc|quy uoc) (?:xong|hoan tat|hoan thanh) (?:roi|moi) (?:${taskVerb}) )`,
  'u',
);
const supportAfterBackend =
  /\b(?:sau khi (?:phan )?(?:backend|back[ -]end|api) (?:xong|hoan tat|hoan thanh)|after (?:the )?(?:backend|api) (?:is (?:ready|done|complete)|lands|finishes))\b/u;
const conditionalOrAlternative =
  /\b(?:if|unless|neu|hoac|or|chi tham khao|de tham khao|for reference only|(?:khong|dung) (?:can |duoc )?(?:sua|viet|lam|giao|nho)|do not (?:edit|work on))\b/u;
const refersTo =
  /\b(?:theo|dua (?:tren|vao)|tham khao|tham chieu|doc tu|based on|according to|using|copy from|refer to)\b/u;
const reviewIntro =
  /^(?:(?:cuoi cung|finally|sau do|then)[, ]+)?(?<leading>[^.;]*?)\b(?:nho|giao(?: cho)?|cho|ask|have) (?:(?:mot|an?) )?(?:nguoi khac|reviewer doc lap|nguoi (?:review|ra soat) doc lap|nguoi chua (?:lam|viet) (?:hai|ca hai) phan do|another (?:person|reviewer)|independent reviewer|someone who did not (?:write|implement) (?:either|both) (?:part|file)s?)\b(?<subject>.+)$/du;
const checkReview = /\b(?:review|ra soat|kiem tra|xem|coi|doi chieu|check|verify|inspect)\b/u;
const onlyPair =
  /\b(?:dung )?(?:hai (?:file|tep)(?: do)?|(?:exactly |the )?two files|both files)\b/u;
const readOnly = /\b(?:chi doc|read[ -]only|only read)\b/u;
const bothReady =
  /\b(?:(?:sau )?khi (?:ca hai|(?:ca )?(?:frontend|ui|giao dien) (?:va|lan) (?:backend|server)) (?:deu )?(?:da )?(?:xong|san sang|hoan tat|hoan thanh)|after both (?:are (?:done|ready|complete)|finish|land))\b/u;
const namedPairByRole = /\b(?:frontend|ui|giao dien) (?:va|lan) (?:backend|server)\b/u;
const narrowReview =
  /\b(?:toan bo|ca repo|them (?:file|tep)|kem theo|cung voi|all files|whole project|in addition to|khong can|bo qua|skip|omit|dung (?:doc|review|ra soat))\b|(?:,\s*|\b(?:roi|va|then|and) )(?:hay |please )?(?:sua|chinh sua|cap nhat|viet lai|fix|edit|update|rewrite)\b/u;
const referenceToFile = /\b(?:file do|tep do|duong dan do|that file|the same file)\b/u;
const preflightIntro =
  /^(?:hai ban cung mo|minh dang mo|ca hai dang xem|both of you (?:opened|are looking at)|we have open)\b/u;
const history = /\b(?:commit(?: moi nhat)?|lich su git|git history|latest commit|git tag)\b/u;
const conditionalFollowup =
  /^(?:chi|only) (?<actor>[\p{L}\p{N}_ '’-]{1,100}?) (?:sua|chinh sua|cap nhat|fix|edit|update) (?<work>.+)$/u;
const ifNecessary =
  /\b(?:neu (?:can|con thieu|chua xong)|if (?:needed|missing|necessary|incomplete))\b/u;
const incomplete = /\b(?:con thieu|chua xong|remaining|unfinished|missing|incomplete)\b/u;
const otherWritersExcluded =
  /^(?<actor>[\p{L}\p{N}_ '’-]{1,100}?) (?:dung|khong (?:duoc|can)|must not|do not) (?:sua|chinh sua|edit|change|write)(?: (?:chung|nha|nhe|file do|that file|too))*$/u;
const absenceCondition =
  /^(?:chi khi|only (?:if|after)) (?<checker>[\p{L}\p{N}_ '’-]{1,100}?) (?:xac nhan|ket luan|bao|confirms|reports) (?:chua co|con thieu|chua (?:duoc )?lam|it is (?:missing|absent)|it does not exist) (?:thi (?:moi )?|moi |then )(?:(?:de|cho|nho|let|ask|have) )?(?<edit>.+)$/u;
const holdUntilCheck =
  /^(?:chua (?:kiem|xac minh|xac nhan) thi (?:khoan|dung) (?:sua|viet)|wait for (?:the )?(?:check|verification) before (?:editing|writing))$/u;

const fold = (text: string) => foldSharedSadeName(text).replace(/\s+/gu, ' ').trim();

function filesIn(text: string) {
  const targets = [...text.matchAll(fileToken)].filter(
    ([file], index, matches) =>
      !/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/iu.test(file) ||
      !/\b(?:tag|version|phien ban)$/u.test(fold(text.slice(0, matches[index].index))),
  );
  const found = [...new Set(targets.map(([file]) => file))];
  return found.every((file) => {
    try {
      return file.length <= 300 && normalizeScope(file) === file && !isPrivateCredentialPath(file);
    } catch {
      return false;
    }
  })
    ? found
    : undefined;
}

function clausesIn(raw: string) {
  const request = raw.trim().normalize('NFC');
  if (!request || request.length > 1600) return;
  const unquoted = request.replace(/(?<=\p{L})['’](?:s|m|re|ve|ll|d)(?=\s|[.,!?;]|$)/giu, '');
  if (/["'“”‘’«»<>\\]|(?:^|[\s`(])(?:[a-z]:)?\/|:\/\//iu.test(unquoted)) return;
  const clauses: Clause[] = [];
  for (const part of request.split(useClause)) {
    const text = part.trim().replace(/[.!?;,]+$/u, '');
    if (!text) continue;
    const files = filesIn(text);
    if (
      !files ||
      text
        .replace(/`([^`]+)`/gu, (match, file: string) => (files.includes(file) ? file : match))
        .includes('`')
    )
      return;
    const words = fold(text.replaceAll('`', ''));
    const prose = fold(text.replace(fileToken, ' '));
    const directives = reviewIntro.test(words)
      ? prose.replace(/\bnguoi chua (?:lam|viet) (?:hai|ca hai) phan do\b/u, 'independent reviewer')
      : prose;
    if (backupOrPublication.test(prose) || platform.test(prose) || unsafeDirective.test(directives))
      return;
    clauses.push({ text, words, files });
  }
  return clauses;
}

function matchingMembers(actor: string, team: readonly Member[]) {
  const name = actor.trim();
  const vietnamese = /^(?<name>.+?) (?:cua|ben) (?<owner>.+)$/u.exec(name)?.groups;
  const english = /^(?:(?<owner>my|your) |(?<person>.+?)['’]s )(?<name>.+)$/u.exec(name)?.groups;
  const ownerFirst = /^(?<owner>.+?) (?:dung|su dung|uses?) (?<name>.+)$/u.exec(name)?.groups;
  const identity = vietnamese ?? english ?? ownerFirst;
  const owner = identity?.owner ?? identity?.person;
  return team.filter(
    (member) =>
      fold(member.name) === (identity?.name ?? name) &&
      (!owner ||
        (['toi', 'tui', 'minh', 'my'].includes(owner)
          ? member.ownedByRequester
          : ['ban', 'ong', 'your'].includes(owner)
            ? !member.ownedByRequester
            : fold(member.owner) === owner)),
  );
}

function named(clause: Clause, team: readonly Member[], words = clause.words) {
  const text = words.replace(assignPreamble, '');
  const matches = [...text.slice(0, 101).matchAll(/ /gu)].flatMap(({ index }) => {
    const action = actionAfterActor.exec(text.slice(index + 1))?.groups;
    if (!action) return [];
    return matchingMembers(text.slice(0, index), team).map((member) => ({
      member,
      writes: writeVerb.test(action.verb),
      work: action.work,
    }));
  });
  if (matches.length === 1) return matches[0];
}

function directWriteScope(words: string, [file, ...others]: string[]) {
  if (!file || others.length) return;
  const index = words.indexOf(fold(file));
  if (index >= 0 && !refersTo.test(words.slice(0, index))) return file;
}

function writer(
  clause: Clause,
  team: readonly Member[],
  words = clause.words,
): Assignment | undefined {
  const action = named(clause, team, words);
  if (!action?.writes || !action.member.allowWrites || conditionalOrAlternative.test(action.work))
    return;
  const file = directWriteScope(action.work, clause.files);
  if (file) return { member: action.member, clause, file };
}

function task(
  key: string,
  title: string,
  kind: PlanTask['kind'],
  scope: string[],
  clause: Clause,
  dependsOn: string[],
  member?: Member,
  condition?: string,
): PlanTask {
  const brief = redact(clause.text);
  return {
    key,
    title,
    kind,
    scope,
    description: brief.length >= 10 ? brief : title,
    acceptance: condition ? `${condition}\n\n${brief}` : `${title}\n\n${brief}`,
    dependsOn,
    ...(member ? { preferredMemberId: member.id } : {}),
    effort: kind === 'code' ? 2 : 1,
    stage: kind === 'review' ? 'Review' : kind === 'research' ? 'Check' : 'Implement',
  };
}

function parallelWrites(clauses: Clause[], team: readonly Member[]): Graph | undefined {
  const intro = parallelIntro.test(clauses[0]?.words ?? '');
  const ending = parallelEnding.test(clauses.at(-1)?.words ?? '');
  if (!intro && !ending) return;
  const work = clauses.slice(intro ? 1 : 0, ending ? -1 : undefined);
  if (work.length !== 2) return;
  const [first, second] = work.map((clause) => writer(clause, team));
  if (!first || !second || scopesOverlap([first.file], [second.file])) return;
  return {
    summary: 'Giao hai phần việc với phạm vi riêng để thực hiện song song.',
    tasks: [first, second].map(({ file, member, clause }, index) =>
      task(
        `parallel-${index + 1}`,
        `Thực hiện phần việc ${index + 1}`,
        'code',
        [file],
        clause,
        [],
        member,
      ),
    ),
  };
}

function checkedWrite(clauses: Clause[], team: readonly Member[]): Graph | undefined {
  const intro = preflightIntro.test(clauses[0]?.words ?? '') ? clauses[0] : undefined;
  const [check, followup, exclusion, ...extra] = clauses.slice(intro ? 1 : 0);
  if (!check || !followup || extra.length) return;
  const author = named(check, team);
  if (!author || author.writes || !history.test(author.work)) return;
  const bound = absenceCondition.exec(followup.words)?.groups;
  const direct = conditionalFollowup.exec(followup.words)?.groups;
  const findings = bound ? matchingMembers(bound.checker, team) : [];
  const boundWriter =
    bound && findings.length === 1 && findings[0] === author.member
      ? named(followup, team, bound.edit)
      : undefined;
  const writer =
    boundWriter?.writes && !conditionalOrAlternative.test(boundWriter.work)
      ? boundWriter.member
      : direct &&
          ifNecessary.test(direct.work) &&
          incomplete.test(direct.work) &&
          matchingMembers(direct.actor, team).includes(author.member)
        ? author.member
        : undefined;
  if (!writer?.allowWrites) return;
  const deny = exclusion && otherWritersExcluded.exec(exclusion.words)?.groups;
  if (
    exclusion &&
    (exclusion.files.length ||
      (!holdUntilCheck.test(exclusion.words) &&
        (!deny || matchingMembers(deny.actor, team).includes(writer))))
  )
    return;
  const files = check.files.length
    ? check.files
    : referenceToFile.test(author.work)
      ? (intro?.files ?? [])
      : [];
  const [file] = files;
  if (
    files.length !== 1 ||
    (intro?.files.length && (intro.files.length !== 1 || intro.files[0] !== file)) ||
    followup.files.some((path) => path !== file)
  )
    return;
  return {
    summary: 'Kiểm tra lịch sử trước và chỉ giao phần cần sửa khi xác nhận phần đó còn thiếu.',
    tasks: [
      task('git-preflight', 'Kiểm tra lịch sử Git', 'research', [file], check, [], author.member),
      {
        ...task(
          'conditional-write',
          'Sửa phần còn thiếu nếu cần',
          'code',
          [file],
          followup,
          ['git-preflight'],
          writer,
          `Chỉ sửa phần còn thiếu nếu kết quả kiểm tra xác nhận cần sửa. Nếu đã hoàn tất, báo kết quả và kết thúc mà không sửa tệp.\n\nYêu cầu kiểm tra gốc:\n${redact(check.text)}`,
        ),
        editIfMissingAfter: 'git-preflight',
      },
    ],
  };
}

function aliases(file: string) {
  const basename = file.split('/').at(-1)!;
  return [...new Set([file, basename, basename.replace(/\.[^.]+$/u, '')])];
}

function reviewsPair(clause: Clause, frontendPath: string, backendPath: string, other: string[]) {
  const reviewMatch = reviewIntro.exec(clause.words);
  const review = reviewMatch?.groups;
  const leading = review?.leading.trim().replace(/[, ]+$/u, '');
  if (
    !review ||
    (leading && bothReady.exec(leading)?.[0] !== leading) ||
    !checkReview.test(`${review.leading} ${review.subject}`) ||
    !onlyPair.test(review.subject) ||
    !bothReady.test(clause.words) ||
    narrowReview.test(clause.words)
  )
    return false;
  const targets =
    /\b(?:hai (?:file|tep)|two files|both files)(?<target>.*?)(?=\b(?:sau )?khi\b|\bafter both\b|$)/du.exec(
      review.subject,
    );
  const readTargets = targets?.groups?.target.trim();
  if (!readTargets || /^(?:do|nay|those)(?:$|, | (?:de|to|for) )/u.test(readTargets)) {
    return (
      (readOnly.test(review.subject) ||
        /\b(?:dung hai (?:file|tep)|exactly (?:the )?two files)\b/u.test(review.subject)) &&
      namedPairByRole.test(clause.words) &&
      !clause.files.length
    );
  }
  const literal = clause.text.replaceAll('\x60', '').replace(/\s+/gu, ' ').trim();
  if (literal.length !== clause.words.length) return false;
  const [subject] = reviewMatch!.indices!.groups!.subject;
  const [start, end] = targets!.indices!.groups!.target;
  const tokens = literal
    .slice(subject + start, subject + end)
    .toLowerCase()
    .trim()
    .split(/\s+(?:v[aà]|and)\s+/u);
  if (tokens.length !== 2) return false;
  const files = [frontendPath, backendPath, ...other];
  const allowedNames = [frontendPath, backendPath]
    .flatMap(aliases)
    .map((name) => name.toLowerCase());
  const resolved = tokens.map((token) =>
    files.filter((file) => aliases(file).some((name) => name.toLowerCase() === token)),
  );
  return (
    clause.files.every((file) => allowedNames.includes(file.toLowerCase())) &&
    resolved.every((matches) => matches.length === 1) &&
    resolved.some(([file]) => file === frontendPath) &&
    resolved.some(([file]) => file === backendPath)
  );
}

function handoff(clauses: Clause[], delivery: SharedDelivery): Graph | undefined {
  const { team, handoffAssignments } = delivery;
  const [first, next, ...tail] = clauses.slice(coordinate.test(clauses[0]?.words ?? '') ? 1 : 0);
  if (!first || !next) return;
  const after = completedTransfer.exec(next.words) ?? nextTransfer.exec(next.words);
  if (!after) return;
  const producer = writer(first, team);
  const receiver = writer(next, team, next.words.slice(after[0].length));
  if (!producer || !receiver || scopesOverlap([producer.file], [receiver.file])) return;

  const parallel =
    completedTransfer.test(next.words) && parallelSibling.test(tail[0]?.words ?? '')
      ? tail.shift()
      : undefined;
  const styleWords = tail[0]?.words ?? '';
  const styleActor = /^(?<actor>.+?) (?:hoi|ask) /u.exec(styleWords)?.groups?.actor;
  const standaloneStyle =
    tail[0] &&
    !tail[0].files.length &&
    (/^(?:nho |hay |please )?(?:hoi |ask |truoc khi |before )/u.test(styleWords) ||
      (styleActor && matchingMembers(styleActor, team).includes(receiver.member))) &&
    /\b(?:style|phong cach|visual design)\b/u.test(styleWords)
      ? tail.shift()
      : undefined;
  const style = groundedHandoffStyle([next.text, standaloneStyle?.text].filter(Boolean).join('. '));
  if (standaloneStyle && !style) return;
  const styleNote =
    style?.kind === 'requester'
      ? 'Before editing, ask the requester which frontend style to use and wait for their choice.'
      : style?.kind === 'supplied'
        ? `Use the requested design requirements. ${redact(style.detail)}`
        : style?.kind === 'delegated'
          ? 'The assigned frontend teammate may choose the design.'
          : undefined;
  const completed: PlanTask[] = [
    task(
      'architecture',
      'Chuẩn bị đầu ra bàn giao',
      'code',
      [producer.file],
      first,
      [],
      producer.member,
    ),
    {
      ...task(
        'frontend',
        'Tiếp nhận và thực hiện nội dung bàn giao',
        'code',
        [receiver.file],
        next,
        ['architecture'],
        receiver.member,
        styleNote,
      ),
      ...(style?.kind === 'requester' ? { askBeforeEditing: frontendStyleQuestion } : {}),
    },
  ];
  if (!parallel && tail.length === 0 && !delivery.handoffDeliverables) {
    if (handoffAssignments)
      assertSharedHandoffPlan(
        parseTeamPlan({ summary: 'Bàn giao hai công việc theo thứ tự.', tasks: completed }),
        handoffAssignments,
      );
    return { summary: 'Bàn giao hai công việc theo đúng phạm vi và thứ tự.', tasks: completed };
  }

  const [backend, tests, review] = parallel ? [parallel, ...tail] : tail;
  const backendFile = backend && directWriteScope(backend.words, backend.files);
  const testsFile = tests && directWriteScope(tests.words, tests.files);
  const testsDeclareOrder =
    testsFile && explicitTestOrder.test(fold(tests.words.replace(fold(testsFile), '')));
  const alternativeWriter = parallel
    ? [producer.member, ...team].find(
        (member) => member.allowWrites && fold(member.owner) !== fold(receiver.member.owner),
      )
    : undefined;
  const explicitlyNamed = (clause: Clause) => {
    const prose = ` ${fold(clause.text.replace(fileToken, ' ').replace(/[^\p{L}\p{M}\p{N}_ -]/gu, ' '))} `;
    return team.some(
      ({ name, owner }) =>
        prose.includes(` ${fold(name)} `) ||
        ['cua', 'cho', 'to'].some((qualifier) => prose.includes(` ${qualifier} ${fold(owner)} `)),
    );
  };
  if (
    tail.length !== (parallel ? 2 : 3) ||
    !contract.test(first.words) ||
    !(frontend.test(next.words) || frontendFile.test(receiver.file)) ||
    !backend ||
    !tests ||
    !review ||
    !backendFile ||
    !testsFile ||
    supportTests.test(backendFile) ||
    explicitlyNamed(backend) ||
    explicitlyNamed(tests) ||
    conditionalOrAlternative.test(backend.words) ||
    conditionalOrAlternative.test(tests.words) ||
    (parallel
      ? !alternativeWriter
      : !supportAssigned.test(backend.words) ||
        !(supportBackend.test(backend.words) || completedTransfer.test(backend.words)) ||
        !contract.test(backend.words)) ||
    !(testsDeclareOrder || supportAssigned.test(tests.words.replace(nextTransfer, ''))) ||
    !supportTests.test(testsFile)
  )
    return;
  const afterBackend = Boolean(testsDeclareOrder || supportAfterBackend.test(tests.words));
  if (
    !afterBackend &&
    !/\b(?:theo|based on|from) (?:contract|hop dong|quy uoc|cau truc)\b/u.test(tests.words)
  )
    return;
  if (!reviewsPair(review, receiver.file, backendFile, [producer.file, testsFile])) return;
  completed.push(
    task(
      'backend',
      'Thực hiện backend theo hợp đồng',
      'code',
      [backendFile],
      backend,
      ['architecture'],
      alternativeWriter,
    ),
    task('codebase', 'Bổ sung bộ kiểm thử theo yêu cầu', 'code', [testsFile], tests, [
      afterBackend ? 'backend' : 'architecture',
    ]),
    task(
      'defensive-review',
      'Rà soát độc lập các tệp được giao',
      'review',
      [receiver.file, backendFile],
      review,
      ['frontend', 'backend'],
    ),
  );
  const graph = {
    summary: 'Hoàn thành hợp đồng, triển khai theo thứ tự và rà soát độc lập.',
    tasks: completed,
  };
  const parsed = parseTeamPlan(graph);
  assertSharedHandoffPlan(
    parsed,
    handoffAssignments ?? {
      producer: { grantId: producer.member.id, scope: producer.file },
      receiver: { grantId: receiver.member.id, scope: receiver.file },
    },
    {
      backend: { scope: backendFile },
      codebase: { scope: testsFile, ...(afterBackend ? { afterBackend: true } : {}) },
      defensiveReview: true,
    },
    true,
  );
  return graph;
}

/** Compile only compound requests whose roles, exact scopes, and ordering are grounded locally. */
export function sharedSadeCompoundPlan(
  delivery: SharedDelivery,
): SharedSadeCloudResult | undefined {
  if (delivery.phase !== 'plan' || delivery.clarification || delivery.readAssignment) return;
  const clauses = clausesIn(delivery.request);
  if (!clauses || clauses.length < 2 || clauses.length > 8) return;
  try {
    const graph = delivery.handoffAssignments
      ? handoff(clauses, delivery)
      : (parallelWrites(clauses, delivery.team) ??
        checkedWrite(clauses, delivery.team) ??
        handoff(clauses, delivery));
    return graph && { kind: 'plan', plan: parseTeamPlan(graph) };
  } catch {
    // A malformed or contradictory graph must fall back to clarification.
    return;
  }
}
