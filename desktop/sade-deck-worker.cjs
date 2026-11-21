'use strict';

const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rmdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const { codeStatus } = require('./claude-client.cjs');
const { findExecutable } = require('./provider-tools.cjs');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localAuthor = 'claude-code';
const failed = { status: 'failed' };
const unavailable = { status: 'unavailable' };

function environment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(?:SADE_|OPENAI_|RELAY_|KIVUNO_|VERCEL(?:_|$)|ANTHROPIC_|CLAUDECODE$|CLAUDE_CODE_(?:OAUTH_TOKEN|ENTRYPOINT|SIMPLE)$)/i.test(
          name,
        ),
    ),
  );
}

async function author({ input, deadlineMs }, cancel) {
  if (
    !input ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs < 4500 ||
    typeof input.instructions !== 'string' ||
    input.instructions.length > 3000 ||
    typeof input.brief !== 'string' ||
    input.brief.length > 14000 ||
    typeof input.schema !== 'string' ||
    input.schema.length > 6000
  )
    return failed;
  const env = environment();
  const command = await findExecutable('claude', env);
  if (!command) return unavailable;
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'kivuno-deck-'));
  try {
    const { $schema, ...outline } = JSON.parse(input.schema);
    const schema = JSON.stringify({
      type: 'object',
      properties: { outline, report: { type: 'string', minLength: 1, maxLength: 400 } },
      required: ['outline', 'report'],
      additionalProperties: false,
    });
    const args = [
      '-p',
      '--safe-mode',
      '--no-chrome',
      '--no-session-persistence',
      '--output-format',
      'json',
      '--json-schema',
      schema,
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--max-turns',
      '3',
      '--system-prompt',
      input.instructions +
        ' Return the slide specification in outline. In report, write one or two complete sentences in the requester’s language, under 350 characters. Say what you prepared and refer to the number of content slides if helpful. Use plain text. The export service checks the outline and adds the cover and references.',
    ];
    // No user configuration hooks, external tools, browser, or workspace files enter this turn.
    const stdout = await new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          env,
          cwd,
          windowsHide: true,
          maxBuffer: 256 * 1024,
          timeout: Math.min(deadlineMs - 3500, 59000),
          signal: cancel,
        },
        (error, stdout) => {
          if (error && !stdout) reject(error);
          else resolve(stdout);
        },
      );
      child.stdin.on('error', () => {});
      child.stdin.end(input.brief, 'utf8');
    });
    const result = JSON.parse(stdout);
    const output = result.structured_output;
    if (result.is_error) return unavailable;
    if (
      result.subtype !== 'success' ||
      !uuid.test(result.session_id) ||
      !output?.outline ||
      typeof output.report !== 'string' ||
      !output.report.trim() ||
      output.report.trim().length > 680
    )
      return failed;
    return {
      status: 'authored',
      sessionId: result.session_id,
      outline: output.outline,
      report: output.report.trim(),
    };
  } catch {
    return failed;
  } finally {
    await rmdir(cwd).catch(() => {});
  }
}

function createSadeDeckWorker({ request, current }) {
  let run;
  let auth;
  let cooldown = 0;

  function ready() {
    if (Date.now() < cooldown) return Promise.resolve(false);
    if (!auth || auth.expires <= Date.now()) {
      auth = {
        expires: Date.now() + 10000,
        promise: codeStatus(environment(), 1700)
          .then(({ signedIn }) => signedIn)
          .catch(() => false),
      };
    }
    return auth.promise;
  }

  function stop() {
    run?.controller.abort();
    run = undefined;
  }

  async function loop(state) {
    const { signal } = state.controller;
    let pending;
    while (!signal.aborted && current(state.owner) && Date.now() < state.until) {
      const before = state.wake;
      if (pending) {
        const reply = await request(state.owner, pending, signal).catch(() => null);
        if (reply?.response.ok || (reply && reply.response.status < 500)) pending = undefined;
      } else {
        const reply = await request(
          state.owner,
          { action: 'worker-poll', runnerId: state.runnerId },
          signal,
        ).catch(() => null);
        if (signal.aborted || !current(state.owner)) break;
        if (reply?.response.ok) {
          const { active, assignment } = reply.body;
          if (!active && before === state.wake) break;
          if (uuid.test(assignment?.id) && uuid.test(assignment.taskId)) {
            const result = await author(assignment, signal).catch(() => failed);
            if (result.status === 'unavailable') cooldown = Date.now() + 60000;
            pending = {
              action: 'worker-result',
              runnerId: state.runnerId,
              id: assignment.id,
              taskId: assignment.taskId,
              result,
            };
            continue;
          }
        } else if (reply && [400, 401, 403, 404].includes(reply.response.status)) {
          break;
        }
      }
      await pause(2400, undefined, { signal });
    }
  }

  function watch(owner) {
    if (run?.owner === owner) {
      run.wake++;
      run.until = Date.now() + 16 * 60000;
      return;
    }
    stop();
    const state = {
      owner,
      controller: new AbortController(),
      runnerId: randomUUID(),
      wake: 0,
      until: Date.now() + 16 * 60000,
    };
    run = state;
    void loop(state)
      .catch(() => {})
      .finally(() => {
        if (run === state) run = undefined;
      });
  }

  return { ready, watch, stop, localAuthor };
}

module.exports = { createSadeDeckWorker };
