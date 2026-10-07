// CLI:  node src/main.ts once        send everything queued, then exit (cron)
//       node src/main.ts reminders   generate today's payment reminders, then send
//       node src/main.ts loop        keep running (server / container)
import { loadConfig } from './config.ts';
import { createDb, createTransport, runOnce } from './worker.ts';

const mode = process.argv[2] ?? 'once';
const cfg = loadConfig();
const db = createDb(cfg);
const transport = createTransport(cfg);

async function tick(reminders: boolean) {
  const r = await runOnce({ db, transport, mailFrom: cfg.mailFrom, batchSize: cfg.batchSize, reminders });
  console.log(`[worker] claimed=${r.claimed} sent=${r.sent} failed=${r.failed}`);
}

if (mode === 'once' || mode === 'reminders') {
  await tick(mode === 'reminders');
  transport.close();
} else if (mode === 'loop') {
  let lastReminderDay = '';
  for (;;) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await tick(today !== lastReminderDay);
      lastReminderDay = today;
    } catch (e) {
      console.error('[worker] run failed:', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
} else {
  console.error('usage: node src/main.ts once|reminders|loop');
  process.exit(2);
}
