import type Database from 'better-sqlite3';

import { StateStoreError, type Migration } from './types.js';

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL
  )
`;

function assertNoDuplicates(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new StateStoreError(
        'migration-version-conflict',
        `duplicate migration version ${migration.version}`
      );
    }
    seen.add(migration.version);
  }
}

function assertAppliedKnown(applied: ReadonlySet<number>, migrations: readonly Migration[]): void {
  const known = new Set(migrations.map((m) => m.version));
  const missing = [...applied].filter((version) => !known.has(version)).sort((a, b) => a - b);
  if (missing.length > 0) {
    throw new StateStoreError(
      'migration-version-conflict',
      `database has applied migrations not present in the supplied list: ${missing.join(', ')}. Upgrade the binary or restore from a backup.`
    );
  }
}

export function runMigrations(db: Database.Database, migrations: readonly Migration[]): void {
  assertNoDuplicates(migrations);
  db.exec(ENSURE_TABLE_SQL);

  const appliedVersions = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => row.version
    )
  );

  assertAppliedKnown(appliedVersions, migrations);

  const pending = [...migrations]
    .filter((migration) => !appliedVersions.has(migration.version))
    .sort((a, b) => a.version - b.version);

  const insertApplied = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of pending) {
    const apply = db.transaction(() => {
      try {
        migration.up(db);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new StateStoreError(
          'migration-failed',
          `migration ${migration.version} (${migration.name}) failed: ${cause}`
        );
      }
      insertApplied.run(migration.version, migration.name, new Date().toISOString());
    });

    apply();
  }
}
