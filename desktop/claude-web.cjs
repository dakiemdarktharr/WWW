'use strict';

const { createHash, randomBytes } = require('node:crypto');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Each instance belongs to one signed-in desktop workspace. The only remote
// operation accepted from the queue is a read against an already enrolled grant.
module.exports = function claudeWebRelay({ origin, current, local, cloud, pause }) {
  const grants = new Map();
  const revocations = new Set();
  const pending = new Map();
  let running = false;
  let stopped = false;
  const active = () => !stopped && current();
  const check = () => {
    if (!active()) throw new Error('The signed-in Kivuno workspace changed.');
  };
  function bound(job) {
    const grant = grants.get(job.connectionId);
    return (
      grant &&
      grant.projectId === job.projectId &&
      grant.memberId === job.memberId &&
      Date.parse(grant.expiresAt) > Date.now()
    );
  }
  async function complete(job, result) {
    check();
    if (!bound(job)) return;
    if (!result.isError) {
      try {
        const state = await local({
          action: 'check',
          connectionId: job.connectionId,
          memberId: job.memberId,
          projectId: job.projectId,
        });
        if (state?.active !== true) throw new Error('Grant unavailable.');
      } catch {
        result = {
          content: [{ type: 'text', text: 'Project access is no longer available.' }],
          isError: true,
        };
      }
    }
    check();
    if (!bound(job)) return;
    await cloud({ action: 'complete', jobId: job.jobId, connectionId: job.connectionId, result });
    pending.delete(job.jobId);
  }
  async function poll() {
    if (running) return;
    running = true;
    let delay = 8_000;
    try {
      while (active()) {
        for (const [id, grant] of grants)
          if (Date.parse(grant.expiresAt) <= Date.now()) grants.delete(id);
        for (const [id, entry] of pending)
          if (!bound(entry.job) || entry.expires <= Date.now()) pending.delete(id);
        if (!grants.size) return;
        try {
          for (const connectionId of revocations) {
            check();
            await cloud({ action: 'revoke', connectionId });
            revocations.delete(connectionId);
          }
          if (!grants.size) continue;
          check();
          const response = await cloud({ action: 'poll' });
          check();
          if (!Array.isArray(response?.jobs)) throw new Error('Invalid connector queue.');
          for (const job of response.jobs.slice(0, 16)) {
            check();
            if (
              !job ||
              !uuid.test(job.jobId) ||
              !bound(job) ||
              (job.after !== undefined && (!Number.isSafeInteger(job.after) || job.after < 0))
            )
              continue;
            let entry = pending.get(job.jobId);
            if (
              entry &&
              (entry.job.connectionId !== job.connectionId ||
                entry.job.after !== job.after ||
                !bound(entry.job))
            )
              continue;
            if (!entry) {
              if (pending.size >= 64) continue;
              let result;
              try {
                result = await local({
                  action: 'read',
                  connectionId: job.connectionId,
                  memberId: job.memberId,
                  projectId: job.projectId,
                  ...(job.after === undefined ? {} : { after: job.after }),
                });
                if (
                  result?.isError ||
                  result?.content?.length !== 1 ||
                  result.content[0]?.type !== 'text' ||
                  typeof result.content[0].text !== 'string' ||
                  Buffer.byteLength(result.content[0].text) > 48 * 1024
                )
                  throw new Error('The project read is unavailable.');
                result = { content: [{ type: 'text', text: result.content[0].text }] };
              } catch {
                result = {
                  content: [
                    {
                      type: 'text',
                      text: 'Project access is no longer available. Check the connector in Kivuno.',
                    },
                  ],
                  isError: true,
                };
              }
              check();
              if (!bound(job)) continue;
              entry = { job, result, expires: Date.now() + 60_000 };
              pending.set(job.jobId, entry);
            }
            await complete(entry.job, entry.result);
          }
          delay = response.jobs.length ? 1500 : 8_000;
        } catch {
          delay = Math.min(delay * 2, 30_000);
        }
        if (active()) await pause(delay);
      }
    } finally {
      running = false;
    }
  }
  return {
    current: active,
    async enroll(input) {
      check();
      if (
        !input ||
        !uuid.test(input.projectId) ||
        !uuid.test(input.memberId) ||
        !Number.isInteger(input.durationMinutes) ||
        input.durationMinutes < 1 ||
        input.durationMinutes > 480
      )
        throw new Error('Choose a project, Claude profile and connector duration.');
      const { projectId, memberId, durationMinutes } = input;
      const grant = await local({ action: 'create', projectId, memberId, durationMinutes });
      const token = 'kwc_' + randomBytes(32).toString('base64url');
      try {
        check();
        const response = await cloud({
          action: 'enroll',
          projectId,
          memberId,
          connectionId: grant.id,
          expiresAt: grant.expiresAt,
          tokenHash: createHash('sha256').update(token).digest('hex'),
        });
        check();
        if (response?.enrolled !== true)
          throw new Error('Kivuno could not register this connector.');
      } catch (error) {
        await local({ action: 'revoke', connectionId: grant.id }).catch(() => {});
        if (active()) {
          void cloud({ action: 'revoke', connectionId: grant.id }).catch(() => {});
        }
        throw error;
      }
      grants.set(grant.id, grant);
      void poll();
      return {
        id: grant.id,
        expiresAt: grant.expiresAt,
        url: origin + '/api/claude/mcp',
        headerName: 'Authorization',
        headerValue: 'Bearer ' + token,
      };
    },
    async revoke(connectionId) {
      check();
      if (!uuid.test(connectionId)) throw new Error('Invalid connector.');
      await local({ action: 'revoke', connectionId });
      grants.delete(connectionId);
      for (const [id, entry] of pending)
        if (entry.job.connectionId === connectionId) pending.delete(id);
      check();
      revocations.add(connectionId);
      try {
        await cloud({ action: 'revoke', connectionId });
        revocations.delete(connectionId);
      } catch {
        throw new Error(
          'Project access was revoked on this computer. Kivuno could not confirm cloud revocation.',
        );
      }
      return { revoked: true };
    },
    stop() {
      stopped = true;
      grants.clear();
      pending.clear();
      revocations.clear();
    },
  };
};
