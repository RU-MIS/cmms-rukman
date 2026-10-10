import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transporter } from 'nodemailer';
import { runOnce } from '../src/worker.ts';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** Fake database: a queue of job ids; commits of the listed ids fail like a statement timeout. */
function fakeDb(queue: string[], failing: string[]) {
  const calls: string[] = [];
  const db = {
    rpc: async (fn: string, args?: { p_job_id?: string }) => {
      calls.push(args?.p_job_id ? `${fn}(${args.p_job_id})` : fn);
      if (fn === 'import_claim_next') return { data: queue.shift() ?? null, error: null };
      if (fn === 'import_commit_job') {
        return failing.includes(args!.p_job_id!)
          ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
          : { data: { job_id: args!.p_job_id, status: 'COMMITTED', imported_rows: 10 }, error: null };
      }
      if (fn === 'email_claim') return { data: [], error: null };
      return { data: null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

test('a queued import that fails to commit does not block the jobs behind it', async () => {
  const { db, calls } = fakeDb(['big', 'small'], ['big']);
  const result = await runOnce({ db, transport: {} as Transporter, mailFrom: 'erp@example.test', log: quiet });
  assert.deepEqual(calls.filter((c) => c.startsWith('import_')),
    ['import_claim_next', 'import_commit_job(big)', 'import_claim_next', 'import_commit_job(small)', 'import_claim_next']);
  assert.equal(result.imports, 1, 'the small job behind the failing one is committed in the same run');
});

test('at most five imports per run', async () => {
  const { db, calls } = fakeDb(['a', 'b', 'c', 'd', 'e', 'f'], []);
  const result = await runOnce({ db, transport: {} as Transporter, mailFrom: 'erp@example.test', log: quiet });
  assert.equal(result.imports, 5);
  assert.equal(calls.filter((c) => c === 'import_claim_next').length, 5);
});
