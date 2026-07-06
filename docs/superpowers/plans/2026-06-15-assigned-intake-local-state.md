# Assigned Issue Intake with Local State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `freesolo watch` default to discovering open issues assigned to the current GitHub user, confirming intake once, and tracking workflow state locally by default.

**Architecture:** Add explicit watcher intake config, issue-source polling, local state initialization, and SQLite intake decisions. The watcher becomes a three-stage pipeline: poll GitHub issues, decide local intake, then drain accepted issues through the existing workflow engine.

**Tech Stack:** TypeScript, Commander, Vitest, better-sqlite3 / `node:sqlite`, GitHub CLI (`gh`), local filesystem state.

---

## File Structure

Modify:

- `src/config/types.ts` - add watcher source/intake/initial-state config types and new defaults.
- `src/config/load.ts` - parse and validate new watcher keys, expose origins.
- `src/config/write.ts` - update default config template.
- `src/commands/config.ts` - allow `config get/set/show` for new keys.
- `src/workflow/local-state-store.ts` - add `initializeState()`.
- `src/workflow/configurable-state.ts` - expose backend-aware initialization.
- `src/state/db.ts` - run migration 002.
- `src/state/watcher-store.ts` - add intake decision CRUD.
- `src/watcher/poll.ts` - support `assigned-to-me` and label issue sources.
- `src/watcher/runner.ts` - add intake decision flow before queue drain.
- `src/commands/watch.ts` - wire config, CLI overrides, and confirm prompt.
- `README.md` - document new defaults and config keys.

Create:

- `src/state/migrations/002-watcher-intake.ts` - SQLite migration for `watcher_intake`.

Tests:

- `tests/unit/config-load.test.ts`
- `tests/unit/config-write.test.ts`
- `tests/unit/config-command.test.ts`
- `tests/unit/local-state-store.test.ts`
- `tests/unit/state-db.test.ts`
- `tests/unit/watcher-store.test.ts`
- `tests/unit/watcher-poll.test.ts`
- `tests/unit/watcher-runner.test.ts`
- `tests/unit/watch-command.test.ts`

---

### Task 1: Expand Config Model and Defaults

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/load.ts`
- Test: `tests/unit/config-load.test.ts`

- [ ] **Step 1: Write failing config default and parsing tests**

Add these tests to `tests/unit/config-load.test.ts`:

```ts
it('defaults watcher intake to assigned-to-me confirm with local state', async () => {
  const config = await loadConfig('/nonexistent/config.yaml');
  expect(config.state_backend).toBe('local');
  expect(config.watcher).toEqual({
    interval_seconds: 60,
    source: 'assigned-to-me',
    intake_mode: 'confirm',
    initial_state: 'triaged',
    trigger_label: 'triaged'
  });
});

it('parses all watcher intake keys', async () => {
  const file = await writeTempConfig(`watcher:
  interval_seconds: 120
  source: label
  intake_mode: auto
  initial_state: planned
  trigger_label: "ready"
`);
  const config = await loadConfig(file);
  expect(config.watcher).toEqual({
    interval_seconds: 120,
    source: 'label',
    intake_mode: 'auto',
    initial_state: 'planned',
    trigger_label: 'ready'
  });
});

it('throws on invalid watcher source', async () => {
  const file = await writeTempConfig(`watcher:
  source: mine
`);
  await expect(loadConfig(file)).rejects.toThrow(/watcher.source/);
});

it('throws on invalid watcher intake mode', async () => {
  const file = await writeTempConfig(`watcher:
  intake_mode: maybe
`);
  await expect(loadConfig(file)).rejects.toThrow(/watcher.intake_mode/);
});

it('throws when watcher initial state is closed', async () => {
  const file = await writeTempConfig(`watcher:
  initial_state: closed
`);
  await expect(loadConfig(file)).rejects.toThrow(/watcher.initial_state/);
});
```

Update the existing expectations that still assert `github-labels` and `state:triaged` defaults:

```ts
expect(config.state_backend).toBe('local');
expect(config.watcher.trigger_label).toBe('triaged');
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/config-load.test.ts
```

Expected: FAIL because `source`, `intake_mode`, and `initial_state` are not defined and the old defaults still apply.

- [ ] **Step 3: Implement config types and defaults**

Update `src/config/types.ts`:

```ts
import type { WorkflowState } from '../workflow/state-machine.js';

export type WatcherSource = 'assigned-to-me' | 'label';
export type WatcherIntakeMode = 'confirm' | 'auto';

export interface WatcherConfig {
  interval_seconds: number;
  source: WatcherSource;
  intake_mode: WatcherIntakeMode;
  initial_state: Exclude<WorkflowState, 'closed'>;
  trigger_label: string;
}

export type StateBackend = 'github-labels' | 'local';

export interface FreesoloConfig {
  watcher: WatcherConfig;
  autonomous_mode: boolean;
  state_backend: StateBackend;
}

export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  interval_seconds: 60,
  source: 'assigned-to-me',
  intake_mode: 'confirm',
  initial_state: 'triaged',
  trigger_label: 'triaged'
};

export const DEFAULT_CONFIG: FreesoloConfig = {
  watcher: DEFAULT_WATCHER_CONFIG,
  autonomous_mode: false,
  state_backend: 'local'
};

export const MIN_INTERVAL_SECONDS = 5;
```

- [ ] **Step 4: Implement parser and validation**

Update imports in `src/config/load.ts`:

```ts
import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_SECONDS,
  type FreesoloConfig,
  type StateBackend,
  type WatcherConfig,
  type WatcherIntakeMode,
  type WatcherSource
} from './types.js';
import { WORKFLOW_STATES, type WorkflowState } from '../workflow/state-machine.js';
```

Update `ConfigWithOrigins.origins`:

```ts
origins: {
  state_backend: ConfigOrigin;
  autonomous_mode: ConfigOrigin;
  'watcher.interval_seconds': ConfigOrigin;
  'watcher.source': ConfigOrigin;
  'watcher.intake_mode': ConfigOrigin;
  'watcher.initial_state': ConfigOrigin;
  'watcher.trigger_label': ConfigOrigin;
};
```

Update `parseWatcherBlock()` branches:

```ts
if (key === 'interval_seconds') {
  result.interval_seconds = Number.parseInt(value, 10);
} else if (key === 'source') {
  result.source = value as WatcherSource;
} else if (key === 'intake_mode') {
  result.intake_mode = value as WatcherIntakeMode;
} else if (key === 'initial_state') {
  result.initial_state = value as Exclude<WorkflowState, 'closed'>;
} else if (key === 'trigger_label') {
  result.trigger_label = value;
}
```

Replace `validateWatcher()` with:

```ts
function validateWatcher(configPath: string, watcher: WatcherConfig): void {
  if (!Number.isFinite(watcher.interval_seconds) || watcher.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`${configPath}: watcher.interval_seconds must be >= ${MIN_INTERVAL_SECONDS}`);
  }
  if (watcher.source !== 'assigned-to-me' && watcher.source !== 'label') {
    throw new Error(`${configPath}: watcher.source must be "assigned-to-me" or "label"`);
  }
  if (watcher.intake_mode !== 'confirm' && watcher.intake_mode !== 'auto') {
    throw new Error(`${configPath}: watcher.intake_mode must be "confirm" or "auto"`);
  }
  if (
    watcher.initial_state === 'closed' ||
    !(WORKFLOW_STATES as readonly string[]).includes(watcher.initial_state)
  ) {
    throw new Error(`${configPath}: watcher.initial_state must be a non-terminal workflow state`);
  }
  if (!watcher.trigger_label.trim()) {
    throw new Error(`${configPath}: watcher.trigger_label must be non-empty`);
  }
}
```

Update `loadConfigWithOrigins()` origins:

```ts
origins: {
  state_backend: origin(repoRaw.state_backend, globalRaw.state_backend),
  autonomous_mode: origin(repoRaw.autonomous_mode, globalRaw.autonomous_mode),
  'watcher.interval_seconds': origin(repoRaw.watcher?.interval_seconds, globalRaw.watcher?.interval_seconds),
  'watcher.source': origin(repoRaw.watcher?.source, globalRaw.watcher?.source),
  'watcher.intake_mode': origin(repoRaw.watcher?.intake_mode, globalRaw.watcher?.intake_mode),
  'watcher.initial_state': origin(repoRaw.watcher?.initial_state, globalRaw.watcher?.initial_state),
  'watcher.trigger_label': origin(repoRaw.watcher?.trigger_label, globalRaw.watcher?.trigger_label)
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/config-load.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/config/types.ts src/config/load.ts tests/unit/config-load.test.ts
rtk git commit -m "feat: add watcher intake config"
```

---

### Task 2: Update Config CLI and Template

**Files:**
- Modify: `src/config/write.ts`
- Modify: `src/commands/config.ts`
- Test: `tests/unit/config-write.test.ts`
- Test: `tests/unit/config-command.test.ts`

- [ ] **Step 1: Write failing template and command tests**

Update `tests/unit/config-write.test.ts` template assertions:

```ts
expect(content).toContain('state_backend: local');
expect(content).toContain('source: assigned-to-me');
expect(content).toContain('intake_mode: confirm');
expect(content).toContain('initial_state: triaged');
expect(content).toContain('trigger_label: "triaged"');
```

Add nested-key write coverage:

```ts
it('replaces watcher source and intake mode within the watcher block', async () => {
  const dir = await makeTempDir();
  const filePath = path.join(dir, 'config.yaml');
  await fs.writeFile(filePath, 'watcher:\n  source: assigned-to-me\n  intake_mode: confirm\n');
  await setConfigKey(filePath, 'watcher.source', 'label');
  await setConfigKey(filePath, 'watcher.intake_mode', 'auto');
  const content = await fs.readFile(filePath, 'utf8');
  expect(content).toContain('source: label');
  expect(content).toContain('intake_mode: auto');
});
```

Update `tests/unit/config-command.test.ts` harness origins:

```ts
origins: {
  state_backend: 'default',
  autonomous_mode: 'default',
  'watcher.interval_seconds': 'default',
  'watcher.source': 'default',
  'watcher.intake_mode': 'default',
  'watcher.initial_state': 'default',
  'watcher.trigger_label': 'default'
}
```

Add config command tests:

```ts
it('sets watcher source', async () => {
  const { program, deps } = buildHarness();
  await program.parseAsync(['config', 'set', 'watcher.source', 'label'], { from: 'user' });
  expect(deps.setConfigKey).toHaveBeenCalledWith(
    '/home/user/.freesolo/config.yaml',
    'watcher.source',
    'label'
  );
});

it('rejects invalid watcher source', async () => {
  const { program, io } = buildHarness();
  await program.parseAsync(['config', 'set', 'watcher.source', 'mine'], { from: 'user' });
  expect(io.exitCode).toBe(1);
  expect(io.stderr.join('')).toMatch(/watcher.source/);
});

it('prints new watcher keys in config show', async () => {
  const { program, io } = buildHarness();
  await program.parseAsync(['config', 'show'], { from: 'user' });
  const out = io.stdout.join('');
  expect(out).toContain('watcher.source');
  expect(out).toContain('watcher.intake_mode');
  expect(out).toContain('watcher.initial_state');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/config-write.test.ts tests/unit/config-command.test.ts
```

Expected: FAIL because the template, valid key list, and show output do not include the new keys.

- [ ] **Step 3: Update config template**

Replace `CONFIG_TEMPLATE` in `src/config/write.ts` with:

```ts
const CONFIG_TEMPLATE = `# All fields are optional - defaults are shown below.

# Where workflow state is persisted.
#   local (default) - stores state in ~/.freesolo/state/<owner>/<repo>/<issue-number>
#   github-labels - writes a state:* label to the GitHub issue on every transition.
state_backend: local

# Autonomous watcher defaults (used by \`freesolo watch\`).
watcher:
  interval_seconds: 60
  source: assigned-to-me
  intake_mode: confirm
  initial_state: triaged
  trigger_label: "triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
`;
```

- [ ] **Step 4: Update config command key handling**

Update `VALID_KEYS` in `src/commands/config.ts`:

```ts
const VALID_KEYS = [
  'state_backend',
  'autonomous_mode',
  'watcher.interval_seconds',
  'watcher.source',
  'watcher.intake_mode',
  'watcher.initial_state',
  'watcher.trigger_label'
] as const;
```

Update `validateValue()`:

```ts
} else if (key === 'watcher.source') {
  if (value !== 'assigned-to-me' && value !== 'label') {
    return `invalid value "${value}" for watcher.source - must be "assigned-to-me" or "label"`;
  }
} else if (key === 'watcher.intake_mode') {
  if (value !== 'confirm' && value !== 'auto') {
    return `invalid value "${value}" for watcher.intake_mode - must be "confirm" or "auto"`;
  }
} else if (key === 'watcher.initial_state') {
  const validInitialStates = ['triaged', 'planned', 'approved', 'implementing', 'reviewing', 'verifying', 'pr-ready', 'merged'];
  if (!validInitialStates.includes(value)) {
    return `invalid value "${value}" for watcher.initial_state - must be a non-terminal workflow state`;
  }
} else if (key === 'watcher.trigger_label') {
```

Update `getConfigValue()`:

```ts
if (key === 'watcher.interval_seconds') return String(config.watcher.interval_seconds);
if (key === 'watcher.source') return config.watcher.source;
if (key === 'watcher.intake_mode') return config.watcher.intake_mode;
if (key === 'watcher.initial_state') return config.watcher.initial_state;
return config.watcher.trigger_label;
```

Update `config show` rows:

```ts
const rows: Array<[string, string, string]> = [
  ['state_backend', result.config.state_backend, result.origins.state_backend],
  ['autonomous_mode', String(result.config.autonomous_mode), result.origins.autonomous_mode],
  ['watcher.interval_seconds', String(result.config.watcher.interval_seconds), result.origins['watcher.interval_seconds']],
  ['watcher.source', result.config.watcher.source, result.origins['watcher.source']],
  ['watcher.intake_mode', result.config.watcher.intake_mode, result.origins['watcher.intake_mode']],
  ['watcher.initial_state', result.config.watcher.initial_state, result.origins['watcher.initial_state']],
  ['watcher.trigger_label', result.config.watcher.trigger_label, result.origins['watcher.trigger_label']]
];
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/config-write.test.ts tests/unit/config-command.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/config/write.ts src/commands/config.ts tests/unit/config-write.test.ts tests/unit/config-command.test.ts
rtk git commit -m "feat: expose watcher intake config"
```

---

### Task 3: Add Local State Initialization

**Files:**
- Modify: `src/workflow/local-state-store.ts`
- Modify: `src/workflow/configurable-state.ts`
- Test: `tests/unit/local-state-store.test.ts`

- [ ] **Step 1: Write failing local initialization tests**

Update import in `tests/unit/local-state-store.test.ts`:

```ts
import { initializeState, readState, writeState } from '../../src/workflow/local-state-store.js';
```

Add tests:

```ts
describe('initializeState', () => {
  it('creates the first local state', async () => {
    await initializeState(repo, testIssueNumber, 'triaged');
    expect(await readState(repo, testIssueNumber)).toBe('triaged');
  });

  it('fails when local state already exists', async () => {
    await initializeState(repo, testIssueNumber, 'triaged');
    await expect(initializeState(repo, testIssueNumber, 'planned')).rejects.toThrow(/already has local workflow state/);
  });

  it('rejects closed as an initial state', async () => {
    await expect(initializeState(repo, testIssueNumber, 'closed')).rejects.toThrow(/cannot be initialized to terminal state/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/local-state-store.test.ts
```

Expected: FAIL because `initializeState` is not exported.

- [ ] **Step 3: Implement `initializeState()`**

Add to `src/workflow/local-state-store.ts`:

```ts
export async function initializeState(
  repo: RepoRef,
  issueNumber: number,
  initialState: WorkflowState
): Promise<void> {
  if (initialState === 'closed') {
    throw new Error(`Issue #${issueNumber} cannot be initialized to terminal state "closed"`);
  }

  if (!(WORKFLOW_STATES as readonly string[]).includes(initialState)) {
    throw new Error(`Issue #${issueNumber} cannot be initialized to unrecognised state "${initialState}"`);
  }

  const existing = await readState(repo, issueNumber);
  if (existing !== null) {
    throw new Error(`Issue #${issueNumber} already has local workflow state "${existing}"`);
  }

  const filePath = stateFilePath(repo, issueNumber);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, initialState, 'utf8');
}
```

Add a backend-aware export in `src/workflow/configurable-state.ts`.

```ts
import { initializeState as localInitializeState } from './local-state-store.js';
import { type RepoRef } from './state-store.js';
```

Then add:

```ts
export async function initializeState(
  repo: RepoRef,
  issueNumber: number,
  initialState: WorkflowState
): Promise<void> {
  if (await useLocalBackend()) {
    return localInitializeState(repo, issueNumber, initialState);
  }

  throw new Error('Issue initialization is only supported with state_backend: local');
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/local-state-store.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/workflow/local-state-store.ts src/workflow/configurable-state.ts tests/unit/local-state-store.test.ts
rtk git commit -m "feat: initialize local issue state"
```

---

### Task 4: Add Watcher Intake Persistence

**Files:**
- Create: `src/state/migrations/002-watcher-intake.ts`
- Modify: `src/state/db.ts`
- Modify: `src/state/watcher-store.ts`
- Test: `tests/unit/state-db.test.ts`
- Test: `tests/unit/watcher-store.test.ts`

- [ ] **Step 1: Write failing migration and store tests**

Add to `tests/unit/state-db.test.ts`:

```ts
it('creates watcher intake table on first open', async () => {
  const db = await openStateDb(tempDbPath());
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);

  expect(tables).toContain('watcher_intake');
  db.close();
});

it('records migration version 2', async () => {
  const db = await openStateDb(tempDbPath());
  const version = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
  expect(version.v).toBe(2);
  db.close();
});
```

Update the existing idempotence test expected version from `1` to `2`.

Add imports to `tests/unit/watcher-store.test.ts`:

```ts
  getIntakeDecision,
  markIntakeAccepted,
  markIntakeIgnored,
```

Add tests:

```ts
describe('watcher intake decisions', () => {
  it('returns null when no intake decision exists', () => {
    expect(getIntakeDecision(db, repo, 42)).toBeNull();
  });

  it('records accepted decisions', () => {
    markIntakeAccepted(db, repo, 42, '2026-06-01T12:00:00.000Z');
    expect(getIntakeDecision(db, repo, 42)).toMatchObject({
      decision: 'accepted',
      issue_updated_at: '2026-06-01T12:00:00.000Z'
    });
  });

  it('records ignored decisions', () => {
    markIntakeIgnored(db, repo, 43, '2026-06-01T13:00:00.000Z');
    expect(getIntakeDecision(db, repo, 43)).toMatchObject({
      decision: 'ignored',
      issue_updated_at: '2026-06-01T13:00:00.000Z'
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/state-db.test.ts tests/unit/watcher-store.test.ts
```

Expected: FAIL because migration 002 and intake helpers do not exist.

- [ ] **Step 3: Add migration 002 and migration runner**

Create `src/state/migrations/002-watcher-intake.ts`:

```ts
export const MIGRATION_002_SQL = `
CREATE TABLE IF NOT EXISTS watcher_intake (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'ignored')),
  decided_at TEXT NOT NULL,
  issue_updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, issue_number)
);
`.trim();
```

Update `src/state/db.ts` imports:

```ts
import { MIGRATION_001_SQL } from './migrations/001-watcher.js';
import { MIGRATION_002_SQL } from './migrations/002-watcher-intake.js';
```

Replace `runMigrations()` with:

```ts
const MIGRATIONS = [
  { version: 1, sql: MIGRATION_001_SQL },
  { version: 2, sql: MIGRATION_002_SQL }
] as const;

function runMigrations(db: StateDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  for (const migration of MIGRATIONS) {
    const applied = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(migration.version);
    if (applied) continue;

    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      migration.version,
      new Date().toISOString()
    );
  }
}
```

- [ ] **Step 4: Add intake store helpers**

Add to `src/state/watcher-store.ts`:

```ts
export type IntakeDecisionValue = 'accepted' | 'ignored';

export interface WatcherIntakeRow {
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  decision: IntakeDecisionValue;
  decided_at: string;
  issue_updated_at: string;
}

export function getIntakeDecision(
  db: StateDb,
  repo: RepoRef,
  issueNumber: number
): WatcherIntakeRow | null {
  const row = db
    .prepare(
      `SELECT repo_owner, repo_name, issue_number, decision, decided_at, issue_updated_at
       FROM watcher_intake
       WHERE repo_owner = ? AND repo_name = ? AND issue_number = ?`
    )
    .get(repo.owner, repo.repo, issueNumber) as WatcherIntakeRow | undefined;
  return row ?? null;
}

function markIntakeDecision(
  db: StateDb,
  repo: RepoRef,
  issueNumber: number,
  issueUpdatedAt: string,
  decision: IntakeDecisionValue
): void {
  db.prepare(
    `INSERT INTO watcher_intake
       (repo_owner, repo_name, issue_number, decision, decided_at, issue_updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_owner, repo_name, issue_number)
     DO UPDATE SET
       decision = excluded.decision,
       decided_at = excluded.decided_at,
       issue_updated_at = excluded.issue_updated_at`
  ).run(repo.owner, repo.repo, issueNumber, decision, new Date().toISOString(), issueUpdatedAt);
}

export function markIntakeAccepted(
  db: StateDb,
  repo: RepoRef,
  issueNumber: number,
  issueUpdatedAt: string
): void {
  markIntakeDecision(db, repo, issueNumber, issueUpdatedAt, 'accepted');
}

export function markIntakeIgnored(
  db: StateDb,
  repo: RepoRef,
  issueNumber: number,
  issueUpdatedAt: string
): void {
  markIntakeDecision(db, repo, issueNumber, issueUpdatedAt, 'ignored');
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/state-db.test.ts tests/unit/watcher-store.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/state/db.ts src/state/migrations/002-watcher-intake.ts src/state/watcher-store.ts tests/unit/state-db.test.ts tests/unit/watcher-store.test.ts
rtk git commit -m "feat: persist watcher intake decisions"
```

---

### Task 5: Support Assigned-Issue Polling

**Files:**
- Modify: `src/watcher/poll.ts`
- Test: `tests/unit/watcher-poll.test.ts`

- [ ] **Step 1: Write failing poll tests**

Add tests to `tests/unit/watcher-poll.test.ts`:

```ts
it('builds assigned-to-me gh args', async () => {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return {
      stdout: JSON.stringify([
        {
          number: 27,
          title: 'Docker Runner',
          updatedAt: '2026-06-08T12:05:18Z',
          labels: [{ name: 'enhancement' }],
          assignees: [{ login: 'robert-gleis' }]
        }
      ]),
      stderr: '',
      exitCode: 0
    };
  };

  const result = await pollIssues({
    repo,
    source: 'assigned-to-me',
    since: '2026-06-01T00:00:00Z',
    triggerLabel: 'triaged',
    gh
  });

  expect(calls[0]).toContain('--assignee');
  expect(calls[0]).toContain('@me');
  expect(calls[0]).not.toContain('--search');
  expect(result.issues).toEqual([
    {
      number: 27,
      title: 'Docker Runner',
      updatedAt: '2026-06-08T12:05:18Z',
      labels: ['enhancement'],
      assignees: ['robert-gleis']
    }
  ]);
});

it('uses label source query for label polling', async () => {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    return { stdout: '[]', stderr: '', exitCode: 0 };
  };

  await pollIssues({
    repo,
    source: 'label',
    since: '2026-06-01T00:00:00Z',
    triggerLabel: 'triaged',
    gh
  });

  expect(calls[0]).toContain('--search');
  expect(calls[0]).toContain('updated:>2026-06-01T00:00:00Z label:triaged');
});
```

Keep existing `pollTriagedIssues()` tests green by either updating them to `pollIssues()` or preserving `pollTriagedIssues()` as a compatibility wrapper.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/watcher-poll.test.ts
```

Expected: FAIL because `pollIssues` does not exist.

- [ ] **Step 3: Implement source-aware polling**

Update `src/watcher/poll.ts` types:

```ts
import type { WatcherSource } from '../config/types.js';
import type { GhRunner, RepoRef } from '../workflow/state-store.js';

export interface WatchIssue {
  number: number;
  title: string;
  updatedAt: string;
  labels: string[];
  assignees: string[];
}

export interface PollInput {
  repo: RepoRef;
  source: WatcherSource;
  since: string;
  triggerLabel: string;
  gh: GhRunner;
  onWarn?: (message: string) => void;
}

export interface PollResult {
  issues: WatchIssue[];
  rateLimited: boolean;
  error?: string;
}

interface GhIssueJson {
  number: number;
  title?: string;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
}
```

Add arg builder:

```ts
function buildIssueListArgs(input: PollInput): string[] {
  const base = [
    'issue',
    'list',
    '--repo',
    `${input.repo.owner}/${input.repo.repo}`,
    '--state',
    'open'
  ];

  if (input.source === 'assigned-to-me') {
    return [
      ...base,
      '--assignee',
      '@me',
      '--json',
      'number,title,updatedAt,labels,assignees',
      '--limit',
      '100'
    ];
  }

  return [
    ...base,
    '--search',
    buildIssueSearchQuery(input.since, input.triggerLabel),
    '--json',
    'number,title,updatedAt,labels,assignees',
    '--limit',
    '100'
  ];
}
```

Replace `pollTriagedIssues()` implementation with source-aware logic:

```ts
export async function pollIssues(input: PollInput): Promise<PollResult> {
  const result = await input.gh(buildIssueListArgs(input));
  if (result.exitCode !== 0) {
    if (isRateLimitError(result.exitCode, result.stderr)) {
      return { issues: [], rateLimited: true };
    }
    const message = result.stderr.trim() || `gh issue list exited ${result.exitCode}`;
    return { issues: [], rateLimited: false, error: message };
  }

  let raw: GhIssueJson[];
  try {
    raw = JSON.parse(result.stdout) as GhIssueJson[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { issues: [], rateLimited: false, error: `failed to parse gh output: ${message}` };
  }

  if (raw.length === 100) {
    input.onWarn?.(
      'gh issue list returned 100 results (pagination limit). Processing all; cursor advance on next poll prevents re-processing.'
    );
  }

  const issues = raw
    .filter((issue) => {
      if (input.source === 'assigned-to-me') return true;
      return (issue.labels ?? []).some((label) => label.name === input.triggerLabel);
    })
    .map((issue) => ({
      number: issue.number,
      title: issue.title ?? '',
      updatedAt: issue.updatedAt,
      labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
      assignees: (issue.assignees ?? []).map((assignee) => assignee.login ?? '').filter(Boolean)
    }));

  return { issues, rateLimited: false };
}

export async function pollTriagedIssues(input: Omit<PollInput, 'source'>): Promise<PollResult> {
  return pollIssues({ ...input, source: 'label' });
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/watcher-poll.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/watcher/poll.ts tests/unit/watcher-poll.test.ts
rtk git commit -m "feat: poll assigned issues"
```

---

### Task 6: Add Intake Flow to Watch Runner

**Files:**
- Modify: `src/watcher/runner.ts`
- Test: `tests/unit/watcher-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Add helper issue in `tests/unit/watcher-runner.test.ts`:

```ts
const assignedIssue = {
  number: 42,
  title: 'Docker Runner',
  updatedAt: '2026-06-02T10:00:00Z',
  labels: ['enhancement'],
  assignees: ['octocat']
};
```

Add tests:

```ts
it('confirms unseen assigned issue and initializes local state before ticking', async () => {
  const prompts: string[] = [];
  const initialized: Array<{ issueNumber: number; state: string }> = [];
  const ticks: number[] = [];

  const result = await runWatchCycle({
    db,
    repo,
    source: 'assigned-to-me',
    intakeMode: 'confirm',
    initialState: 'triaged',
    triggerLabel: 'triaged',
    poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
    confirmIntake: async (issue) => {
      prompts.push(issue.title);
      return true;
    },
    readState: async () => null,
    initializeState: async ({ issueNumber, initialState }) => {
      initialized.push({ issueNumber, state: initialState });
    },
    tick: async ({ issueNumber }) => {
      ticks.push(issueNumber);
      return {
        issueNumber,
        fromState: 'triaged',
        toState: 'triaged',
        action: { kind: 'wait', reason: 'agent owns work' }
      };
    },
    now: () => new Date('2026-06-02T12:00:00Z')
  });

  expect(prompts).toEqual(['Docker Runner']);
  expect(initialized).toEqual([{ issueNumber: 42, state: 'triaged' }]);
  expect(ticks).toEqual([42]);
  expect(result.enqueued).toBe(1);
  expect(result.processed).toBe(1);
});

it('records ignored decision when confirm returns false', async () => {
  const result = await runWatchCycle({
    db,
    repo,
    source: 'assigned-to-me',
    intakeMode: 'confirm',
    initialState: 'triaged',
    triggerLabel: 'triaged',
    poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
    confirmIntake: async () => false,
    readState: async () => null,
    initializeState: async () => {
      throw new Error('should not initialize');
    },
    tick: async () => {
      throw new Error('should not tick');
    },
    now: () => new Date('2026-06-02T12:00:00Z')
  });

  expect(result.enqueued).toBe(0);
  expect(result.processed).toBe(0);
});

it('auto intake accepts without prompting', async () => {
  const initialized: number[] = [];

  await runWatchCycle({
    db,
    repo,
    source: 'assigned-to-me',
    intakeMode: 'auto',
    initialState: 'triaged',
    triggerLabel: 'triaged',
    poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
    confirmIntake: async () => {
      throw new Error('should not prompt');
    },
    readState: async () => null,
    initializeState: async ({ issueNumber }) => {
      initialized.push(issueNumber);
    },
    tick: async ({ issueNumber }) => ({
      issueNumber,
      fromState: 'triaged',
      toState: 'triaged',
      action: { kind: 'wait', reason: 'agent owns work' }
    }),
    now: () => new Date('2026-06-02T12:00:00Z')
  });

  expect(initialized).toEqual([42]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/watcher-runner.test.ts
```

Expected: FAIL because runner deps do not include intake config or initialization hooks.

- [ ] **Step 3: Update runner interfaces and intake flow**

Update imports in `src/watcher/runner.ts`:

```ts
import type { WatcherIntakeMode, WatcherSource } from '../config/types.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import type { WatchIssue, PollResult } from './poll.js';
```

Update `WatchCycleDeps`:

```ts
export interface WatchCycleDeps {
  db: StateDb;
  repo: RepoRef;
  source: WatcherSource;
  intakeMode: WatcherIntakeMode;
  initialState: Exclude<WorkflowState, 'closed'>;
  triggerLabel: string;
  sinceOverride?: string;
  poll: (since: string) => Promise<PollResult>;
  confirmIntake?: (issue: WatchIssue) => Promise<boolean>;
  readState: (input: { repo: RepoRef; issueNumber: number }) => Promise<WorkflowState | null>;
  initializeState: (input: {
    repo: RepoRef;
    issueNumber: number;
    initialState: Exclude<WorkflowState, 'closed'>;
  }) => Promise<void>;
  tick: (input: { repo: RepoRef; issueNumber: number }) => Promise<TickResult>;
  now?: () => Date;
}
```

Add intake helper:

```ts
async function intakeIssue(deps: WatchCycleDeps, issue: WatchIssue): Promise<boolean> {
  const decision = getIntakeDecision(deps.db, deps.repo, issue.number);
  if (decision?.decision === 'ignored') return false;
  if (decision?.decision === 'accepted') return true;

  const existingState = await deps.readState({ repo: deps.repo, issueNumber: issue.number });
  if (existingState !== null) {
    markIntakeAccepted(deps.db, deps.repo, issue.number, issue.updatedAt);
    return true;
  }

  const accepted = deps.intakeMode === 'auto'
    ? true
    : await (deps.confirmIntake ?? (async () => {
        throw new Error('watcher intake confirmation requires an interactive prompt');
      }))(issue);

  if (!accepted) {
    markIntakeIgnored(deps.db, deps.repo, issue.number, issue.updatedAt);
    return false;
  }

  await deps.initializeState({
    repo: deps.repo,
    issueNumber: issue.number,
    initialState: deps.initialState
  });
  markIntakeAccepted(deps.db, deps.repo, issue.number, issue.updatedAt);
  return true;
}
```

In `runWatchCycle()`, replace direct enqueue loop with:

```ts
let enqueued = 0;
for (const issue of pollResult.issues) {
  if (!(await intakeIssue(deps, issue))) {
    continue;
  }
  if (enqueueIssue(deps.db, deps.repo, issue.number, issue.updatedAt)) {
    enqueued += 1;
  }
}
```

Update existing tests to pass:

```ts
source: 'label',
intakeMode: 'auto',
initialState: 'triaged',
readState: async () => 'triaged',
initializeState: async () => {},
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/watcher-runner.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/watcher/runner.ts tests/unit/watcher-runner.test.ts
rtk git commit -m "feat: add watcher intake flow"
```

---

### Task 7: Wire Watch Command Prompts and Overrides

**Files:**
- Modify: `src/commands/watch.ts`
- Test: `tests/unit/watch-command.test.ts`

- [ ] **Step 1: Write failing command tests**

Update `tests/unit/watch-command.test.ts` harness config:

```ts
loadConfig: vi.fn().mockResolvedValue({
  state_backend: 'local',
  autonomous_mode: false,
  watcher: {
    interval_seconds: 60,
    source: 'assigned-to-me',
    intake_mode: 'confirm',
    initial_state: 'triaged',
    trigger_label: 'triaged'
  }
}),
```

Add tests:

```ts
it('passes default watcher intake config to runWatchLoop', async () => {
  const { program, deps } = buildHarness();

  await program.parseAsync(['node', 'freesolo', 'watch', 'run']);

  expect(deps.runWatchLoop).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'assigned-to-me',
      intakeMode: 'confirm',
      initialState: 'triaged',
      triggerLabel: 'triaged'
    })
  );
});

it('passes source and intake mode CLI overrides', async () => {
  const { program, deps } = buildHarness();

  await program.parseAsync([
    'node',
    'freesolo',
    'watch',
    'run',
    '--source',
    'label',
    '--trigger-label',
    'ready',
    '--intake-mode',
    'auto'
  ]);

  expect(deps.runWatchLoop).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'label',
      intakeMode: 'auto',
      triggerLabel: 'ready'
    })
  );
});

it('treats --trigger-label as label source when source is omitted', async () => {
  const { program, deps } = buildHarness();

  await program.parseAsync([
    'node',
    'freesolo',
    'watch',
    'run',
    '--trigger-label',
    'state:triaged'
  ]);

  expect(deps.runWatchLoop).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'label',
      triggerLabel: 'state:triaged'
    })
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk npm test -- tests/unit/watch-command.test.ts
```

Expected: FAIL because command options and runner deps do not match the new interface.

- [ ] **Step 3: Add command deps for prompting and state initialization**

Update imports in `src/commands/watch.ts`:

```ts
import { confirm } from '@inquirer/prompts';
import { pollIssues } from '../watcher/poll.js';
import {
  initializeState as defaultInitializeState,
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/configurable-state.js';
import type { WatcherIntakeMode, WatcherSource } from '../config/types.js';
```

Add to `WatchCommandDeps`:

```ts
confirmIntake: (input: { issueNumber: number; title: string }) => Promise<boolean>;
readState: typeof defaultReadState;
initializeState: typeof defaultInitializeState;
```

Add default deps:

```ts
confirmIntake: ({ issueNumber, title }) =>
  confirm({ message: `Start issue #${issueNumber} "${title}"?`, default: false }),
readState: defaultReadState,
initializeState: defaultInitializeState,
```

Update `buildCycleDeps()` signature:

```ts
async function buildCycleDeps(
  deps: WatchCommandDeps,
  db: StateDb,
  repo: RepoRef,
  source: WatcherSource,
  intakeMode: WatcherIntakeMode,
  initialState: FreesoloConfig['watcher']['initial_state'],
  triggerLabel: string,
  sinceOverride?: string
)
```

Return new runner deps:

```ts
return {
  db,
  repo,
  source,
  intakeMode,
  initialState,
  triggerLabel,
  sinceOverride,
  poll: (since: string) =>
    pollIssues({
      repo,
      source,
      since,
      triggerLabel,
      gh: defaultRunner,
      onWarn: (message) => deps.write('stderr', `${message}\n`)
    }),
  confirmIntake: (issue) => deps.confirmIntake({ issueNumber: issue.number, title: issue.title }),
  readState: ({ repo: inputRepo, issueNumber }) => deps.readState(inputRepo, issueNumber),
  initializeState: ({ repo: inputRepo, issueNumber, initialState: state }) =>
    deps.initializeState(inputRepo, issueNumber, state),
  tick: (input: { repo: RepoRef; issueNumber: number }): Promise<TickResult> =>
    createWorkflowEngine(defaultEngineDeps).tick(input)
};
```

- [ ] **Step 4: Add CLI option parsing**

Add parsers:

```ts
function parseSource(value: string): WatcherSource {
  if (value !== 'assigned-to-me' && value !== 'label') {
    throw new InvalidArgumentError('source must be "assigned-to-me" or "label"');
  }
  return value;
}

function parseIntakeMode(value: string): WatcherIntakeMode {
  if (value !== 'confirm' && value !== 'auto') {
    throw new InvalidArgumentError('intake mode must be "confirm" or "auto"');
  }
  return value;
}
```

Add options to `run` and `once`:

```ts
.addOption(new Option('--source <source>', 'Issue source override').argParser(parseSource))
.addOption(new Option('--intake-mode <mode>', 'Intake mode override').argParser(parseIntakeMode))
```

Use resolved values in `run`:

```ts
const source = options.source ?? (options.triggerLabel ? 'label' : config.watcher.source);
const intakeMode = options.intakeMode ?? config.watcher.intake_mode;
const initialState = config.watcher.initial_state;
const triggerLabel = options.triggerLabel ?? config.watcher.trigger_label;
```

Use the same resolved values in `once`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk npm test -- tests/unit/watch-command.test.ts
```

Expected: PASS.

Commit:

```bash
rtk git add src/commands/watch.ts tests/unit/watch-command.test.ts
rtk git commit -m "feat: wire watcher intake CLI"
```

---

### Task 8: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Test: relevant unit suites plus full test suite

- [ ] **Step 1: Update README watch section**

Replace the `watch` section in `README.md` with:

```md
### `watch` - autonomous issue watcher

By default, `watch` polls GitHub for open issues assigned to the authenticated `gh` user. New issues are confirmed once, then FreeSolo stores workflow state locally and drains accepted issues through the Workflow Engine.

```bash
# Single poll + drain cycle
freesolo watch once

# Continuous loop - graceful shutdown on SIGINT/SIGTERM
FREESOLO_ENGINE=1 freesolo watch run
FREESOLO_ENGINE=1 freesolo watch run --interval 30

# Fully automatic intake for assigned issues
FREESOLO_ENGINE=1 freesolo watch run --intake-mode auto

# Compatibility: label-triggered polling
FREESOLO_ENGINE=1 freesolo watch run --source label --trigger-label triaged
```

Configure defaults in `~/.freesolo/config.yaml` or `.freesolo/config.yaml` (see [Global configuration](#global-configuration)).
```

Update the global config template in `README.md` to match `src/config/write.ts`.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
rtk npm test -- tests/unit/config-load.test.ts tests/unit/config-write.test.ts tests/unit/config-command.test.ts tests/unit/local-state-store.test.ts tests/unit/state-db.test.ts tests/unit/watcher-store.test.ts tests/unit/watcher-poll.test.ts tests/unit/watcher-runner.test.ts tests/unit/watch-command.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 4: Build**

Run:

```bash
rtk npm run build
```

Expected: PASS.

- [ ] **Step 5: Check final diff**

Run:

```bash
rtk git diff --check
rtk git status --short
```

Expected:

- `git diff --check` prints no errors.
- `git status --short` contains only intended files for this feature.

- [ ] **Step 6: Commit docs and final verification**

Commit:

```bash
rtk git add README.md
rtk git commit -m "docs: document assigned issue intake"
```

If verification required code touch-ups, include the touched files in the same commit with this message instead:

```bash
rtk git add README.md src tests
rtk git commit -m "chore: verify assigned issue intake"
```

---

## Self-Review Notes

Spec coverage:

- Local default state backend: Task 1, Task 2, Task 8.
- Assigned-to-me default source: Task 1, Task 5, Task 7.
- Confirm intake default: Task 1, Task 6, Task 7.
- Local initialization of `triaged`: Task 3, Task 6.
- Accepted/ignored persistence: Task 4, Task 6.
- Configurable source/intake/initial/label behavior: Task 1, Task 2, Task 7.
- Backward-compatible label trigger: Task 5, Task 7, Task 8.
- Error handling for non-interactive confirm: Task 6.
- Tests and docs: every task includes targeted tests; Task 8 includes full verification.

Type consistency:

- Config names use snake_case for YAML and camelCase for runner deps: `intake_mode` -> `intakeMode`, `initial_state` -> `initialState`.
- Polling uses `WatchIssue` consistently across poller, runner, and prompt.
- Intake decisions use exactly `accepted` and `ignored`.
