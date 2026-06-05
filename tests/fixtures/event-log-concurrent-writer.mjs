// Standalone Node script invoked via child_process.fork from the concurrency
// test. Waits for { type: 'go' }, inserts rows into events, exits cleanly.
import Database from 'better-sqlite3';

const dbPath = process.env.EVENT_LOG_DB_PATH;
const rowCount = Number.parseInt(process.env.EVENT_LOG_ROW_COUNT ?? '0', 10);

if (!dbPath || rowCount <= 0) {
  console.error('worker missing EVENT_LOG_DB_PATH or EVENT_LOG_ROW_COUNT');
  process.exit(2);
}

process.once('message', (message) => {
  if (!message || typeof message !== 'object' || message.type !== 'go') {
    process.exit(3);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const insert = db.prepare(`
    INSERT INTO events (event_type, agent_id, payload_json, schema_version, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);
  const createdAt = new Date().toISOString();
  for (let i = 0; i < rowCount; i++) {
    insert.run('agent.created', String(process.pid), JSON.stringify({ pid: process.pid, i }), createdAt);
  }
  db.close();

  process.send({ type: 'done', pid: process.pid, written: rowCount }, undefined, undefined, () =>
    process.exit(0)
  );
});
