// Standalone Node script invoked via child_process.fork from the concurrency
// test. Communicates with the parent over IPC: it waits for a single
// { type: 'go' } message, then opens its own connection to the shared DB,
// inserts N rows tagged with its PID, and exits cleanly. Stays as `.mjs` so
// it runs without a TypeScript build step.
import Database from 'better-sqlite3';

const dbPath = process.env.STATE_STORE_DB_PATH;
const rowCount = Number.parseInt(process.env.STATE_STORE_ROW_COUNT ?? '0', 10);

if (!dbPath || rowCount <= 0) {
  console.error('worker missing STATE_STORE_DB_PATH or STATE_STORE_ROW_COUNT');
  process.exit(2);
}

process.once('message', (message) => {
  if (!message || typeof message !== 'object' || message.type !== 'go') {
    process.exit(3);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const insert = db.prepare('INSERT INTO test_events (pid, payload) VALUES (?, ?)');
  for (let i = 0; i < rowCount; i++) {
    insert.run(process.pid, `row-${i}`);
  }
  db.close();

  // Use the callback form of process.send so the IPC channel is flushed
  // before we exit. Bare `process.send(...); process.exit(0)` races: Node
  // does not guarantee the IPC message is delivered before the process tears
  // down, so the parent can see code===0 with no `done` message.
  process.send(
    { type: 'done', pid: process.pid, written: rowCount },
    undefined,
    undefined,
    () => process.exit(0)
  );
});
