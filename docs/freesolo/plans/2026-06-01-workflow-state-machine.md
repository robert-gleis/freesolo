# Workflow State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the explicit, persisted workflow state machine described in [docs/freesolo/specs/2026-06-01-workflow-state-machine-design.md](../specs/2026-06-01-workflow-state-machine-design.md) so every FreeSolo-managed GitHub issue advances only through enumerated transitions stored as `state:*` labels.

**Architecture:** Three new modules — a pure `state-machine.ts` (transition table + error type), a `state-store.ts` that talks to `gh` for label I/O, and a `state.ts` command group that wires `freesolo state get` / `freesolo state transition` into the CLI. Transitions are gated by `FREESOLO_ENGINE=1` so agent processes cannot mutate state directly. All `gh` calls are injected via a runner function so unit tests stay hermetic.

**Tech Stack:** TypeScript 5.9, Node.js 20, `commander` 14, `execa` 9, `zod` 4 (already in package), Vitest 3.

---

## File Structure

- Modify: `src/core/types.ts` — export `RepoRef = Pick<RepoContext, 'owner' | 'repo'>` so there is one canonical repo-identifier type.
- Create: `src/workflow/state-machine.ts` — pure domain: state list, transition table, `canTransition`, `assertTransition`, `InvalidTransitionError`.
- Create: `src/workflow/state-store.ts` — `gh`-backed I/O: `readState`, `writeState`, `ensureStateLabels`, `MultipleStateLabelsError`, plus an injectable `GhRunner` type. Re-exports `RepoRef` from `core/types.ts`.
- Create: `src/commands/state.ts` — Commander action handlers and the `registerStateCommands(program)` helper used by `cli.ts`.
- Modify: `src/cli.ts` — register the `state` command group alongside `start`.
- Create: `tests/unit/state-machine.test.ts` — table-driven coverage of transitions, self-transitions, error shape.
- Create: `tests/unit/state-store.test.ts` — `readState`/`writeState`/`ensureStateLabels` against a fake `GhRunner`.
- Create: `tests/unit/state-command.test.ts` — CLI surface, `FREESOLO_ENGINE` gate, exit codes.
- Modify: `tests/unit/cli.test.ts` — assert the `state` group is registered.

---

## Task 1: State Machine Domain Module

**Files:**
- Create: `src/workflow/state-machine.ts`
- Test: `tests/unit/state-machine.test.ts`

- [ ] **Step 1: Write the failing tests for the transition table and error**

Create `tests/unit/state-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  TRANSITIONS,
  WORKFLOW_STATES,
  type WorkflowState
} from '../../src/workflow/state-machine.js';

describe('WORKFLOW_STATES', () => {
  it('lists the nine canonical states in order', () => {
    expect(WORKFLOW_STATES).toEqual([
      'triaged',
      'planned',
      'approved',
      'implementing',
      'reviewing',
      'verifying',
      'pr-ready',
      'merged',
      'closed'
    ]);
  });
});

describe('canTransition', () => {
  const allowedPairs: Array<[WorkflowState, WorkflowState]> = [
    ['triaged', 'planned'],
    ['planned', 'approved'],
    ['planned', 'triaged'],
    ['approved', 'implementing'],
    ['approved', 'planned'],
    ['implementing', 'reviewing'],
    ['implementing', 'approved'],
    ['reviewing', 'verifying'],
    ['reviewing', 'implementing'],
    ['verifying', 'pr-ready'],
    ['verifying', 'implementing'],
    ['pr-ready', 'merged'],
    ['pr-ready', 'implementing'],
    ['merged', 'closed']
  ];

  it.each(allowedPairs)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('allows every self-transition as a no-op', () => {
    for (const state of WORKFLOW_STATES) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  it('rejects transitions out of the terminal closed state', () => {
    for (const target of WORKFLOW_STATES) {
      if (target === 'closed') continue;
      expect(canTransition('closed', target)).toBe(false);
    }
  });

  it('rejects a representative invalid skip', () => {
    expect(canTransition('triaged', 'implementing')).toBe(false);
    expect(canTransition('planned', 'merged')).toBe(false);
    expect(canTransition('reviewing', 'closed')).toBe(false);
  });

  it('exports TRANSITIONS as the source of truth keyed by every state', () => {
    for (const state of WORKFLOW_STATES) {
      expect(TRANSITIONS[state]).toBeDefined();
    }
  });
});

describe('assertTransition', () => {
  it('returns void for allowed transitions', () => {
    expect(() => assertTransition('triaged', 'planned')).not.toThrow();
  });

  it('returns void for self-transitions', () => {
    expect(() => assertTransition('implementing', 'implementing')).not.toThrow();
  });

  it('throws InvalidTransitionError naming from, to, and allowed-next', () => {
    let captured: unknown;

    try {
      assertTransition('triaged', 'merged');
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidTransitionError);
    const err = captured as InvalidTransitionError;
    expect(err.from).toBe('triaged');
    expect(err.to).toBe('merged');
    expect(err.allowedNext).toEqual(['planned']);
    expect(err.message).toBe(
      'Invalid workflow transition: triaged → merged. Allowed from triaged: planned.'
    );
  });

  it('formats a terminal-state error clearly', () => {
    let captured: unknown;

    try {
      assertTransition('closed', 'triaged');
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidTransitionError);
    expect((captured as InvalidTransitionError).message).toBe(
      'Invalid workflow transition: closed → triaged. Allowed from closed: (terminal).'
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/unit/state-machine.test.ts`

Expected: FAIL with "Cannot find module '../../src/workflow/state-machine.js'".

- [ ] **Step 3: Implement the state machine module**

Create `src/workflow/state-machine.ts`:

```ts
export const WORKFLOW_STATES = [
  'triaged',
  'planned',
  'approved',
  'implementing',
  'reviewing',
  'verifying',
  'pr-ready',
  'merged',
  'closed'
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  triaged: ['planned'],
  planned: ['approved', 'triaged'],
  approved: ['implementing', 'planned'],
  implementing: ['reviewing', 'approved'],
  reviewing: ['verifying', 'implementing'],
  verifying: ['pr-ready', 'implementing'],
  'pr-ready': ['merged', 'implementing'],
  merged: ['closed'],
  closed: []
};

export class InvalidTransitionError extends Error {
  readonly from: WorkflowState;
  readonly to: WorkflowState;
  readonly allowedNext: readonly WorkflowState[];

  constructor(from: WorkflowState, to: WorkflowState, allowedNext: readonly WorkflowState[]) {
    const allowed = allowedNext.length > 0 ? allowedNext.join(', ') : '(terminal)';
    super(`Invalid workflow transition: ${from} → ${to}. Allowed from ${from}: ${allowed}.`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.allowedNext = allowedNext;
  }
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  if (from === to) {
    return true;
  }

  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState): void {
  if (canTransition(from, to)) {
    return;
  }

  throw new InvalidTransitionError(from, to, TRANSITIONS[from]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/state-machine.test.ts`

Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/state-machine.ts tests/unit/state-machine.test.ts
git commit -m "Add workflow state machine domain module"
```

---

## Task 2: State Store I/O Module

**Files:**
- Modify: `src/core/types.ts` (add `RepoRef` alias)
- Create: `src/workflow/state-store.ts`
- Test: `tests/unit/state-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/state-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import {
  defaultRunner,
  ensureStateLabels,
  MultipleStateLabelsError,
  readState,
  STATE_LABEL_PREFIX,
  writeState,
  type GhRunner
} from '../../src/workflow/state-store.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
const { execa } = await import('execa');

beforeEach(() => {
  vi.mocked(execa).mockReset();
});

interface Call {
  args: string[];
}

interface ScriptedReply {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function buildRunner(reply: (call: Call) => ScriptedReply | Promise<ScriptedReply>): {
  runner: GhRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: GhRunner = async (args) => {
    const call = { args };
    calls.push(call);
    const result = await reply(call);
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  };
  return { runner, calls };
}

const repo = { owner: 'acme', repo: 'widgets' };

describe('readState', () => {
  it('returns null when no state:* label is present', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({ labels: [{ name: 'bug' }, { name: 'priority-1' }] })
    }));

    expect(await readState(repo, 42, { gh: runner })).toBeNull();
  });

  it('returns the canonical state when exactly one state:* label is present', async () => {
    const { runner, calls } = buildRunner(() => ({
      stdout: JSON.stringify({ labels: [{ name: 'bug' }, { name: 'state:implementing' }] })
    }));

    expect(await readState(repo, 42, { gh: runner })).toBe('implementing');
    expect(calls[0].args).toEqual([
      'issue',
      'view',
      '42',
      '--repo',
      'acme/widgets',
      '--json',
      'labels'
    ]);
  });

  it('throws MultipleStateLabelsError when more than one state:* label is set', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({
        labels: [{ name: 'state:planned' }, { name: 'state:approved' }]
      })
    }));

    await expect(readState(repo, 42, { gh: runner })).rejects.toBeInstanceOf(MultipleStateLabelsError);
  });
});

describe('writeState', () => {
  it('rejects an invalid transition before touching gh', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await expect(writeState(repo, 42, 'triaged', 'merged', { gh: runner })).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    expect(calls).toEqual([]);
  });

  it('is a no-op for self-transitions', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await writeState(repo, 42, 'implementing', 'implementing', { gh: runner });

    expect(calls).toEqual([]);
  });

  it('creates the target label up-front before swapping', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await writeState(repo, 42, 'triaged', 'planned', { gh: runner });

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual([
      'label',
      'create',
      'state:planned',
      '--repo',
      'acme/widgets',
      '--color',
      'C5DEF5',
      '--description',
      'FreeSolo workflow state: planned',
      '--force'
    ]);
    expect(calls[1].args).toEqual([
      'issue',
      'edit',
      '42',
      '--repo',
      'acme/widgets',
      '--remove-label',
      'state:triaged',
      '--add-label',
      'state:planned'
    ]);
  });
});

describe('ensureStateLabels', () => {
  it('creates every state:* label idempotently with --force', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await ensureStateLabels(repo, { gh: runner });

    expect(calls).toHaveLength(9);
    for (const call of calls) {
      expect(call.args[0]).toBe('label');
      expect(call.args[1]).toBe('create');
      expect(call.args).toContain('--force');
      expect(call.args[2].startsWith(STATE_LABEL_PREFIX)).toBe(true);
    }
  });
});

describe('defaultRunner', () => {
  it('throws a friendly "GitHub CLI" message when execa rejects without an exitCode (spawn failure)', async () => {
    // Real execa 9 spawn failures (e.g. missing `gh` binary) reject with an
    // ExecaError whose `exitCode` is undefined. Mirror that shape with a plain
    // Error that has no `exitCode` property.
    vi.mocked(execa).mockRejectedValueOnce(new Error('spawn gh ENOENT'));

    await expect(defaultRunner(['issue', 'view', '1'])).rejects.toThrow(/GitHub CLI/);
  });

  it('passes through non-zero exit codes without throwing', async () => {
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error('command failed'), {
        exitCode: 1,
        stderr: 'gh: no auth',
        stdout: '',
        failed: true,
        shortMessage: 'Command failed with exit code 1: gh issue view 1'
      })
    );

    const result = await defaultRunner(['issue', 'view', '1']);
    expect(result).toEqual({ exitCode: 1, stderr: 'gh: no auth', stdout: '' });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/unit/state-store.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the state store**

`defaultRunner` discriminates on `execaError.exitCode`: a spawn failure (binary missing, permission denied) rejects with `exitCode === undefined` and is thrown as the friendly "freesolo requires GitHub CLI access" message; a non-zero exit (binary ran, returned non-zero) carries a numeric `exitCode` and is returned as a `GhResult` so consumers can keep their `result.exitCode !== 0` checks. This is more robust across execa upgrades than sniffing `error.code === 'ENOENT'`.

First update `src/core/types.ts` to add the canonical `RepoRef` alias so we don't double up on repo-identifier types. Append:

```ts
export type RepoRef = Pick<RepoContext, 'owner' | 'repo'>;
```

Then create `src/workflow/state-store.ts`:

```ts
import { execa } from 'execa';

import type { RepoRef } from '../core/types.js';
import { assertTransition, WORKFLOW_STATES, type WorkflowState } from './state-machine.js';

export const STATE_LABEL_PREFIX = 'state:';

export type { RepoRef };

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

export interface StateStoreDeps {
  gh?: GhRunner;
}

export const defaultRunner: GhRunner = async (args) => {
  try {
    const result = await execa('gh', args);
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  } catch (error) {
    // execa 9 distinguishes spawn failures (binary missing, permission denied,
    // etc.) from non-zero exits by whether the rejection carries an `exitCode`.
    // Spawn failures reject with `exitCode === undefined`; treat those as
    // "gh isn't usable" and surface the friendly install hint. Rejections that
    // DO carry an `exitCode` mean the binary ran but exited non-zero — surface
    // those as a GhResult so consumers (`readState`, `writeState`,
    // `createStateLabel`) can keep using `result.exitCode !== 0` checks and
    // produce their own messages from the captured stderr.
    const execaError = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };

    if (execaError?.exitCode === undefined) {
      throw new Error('freesolo requires GitHub CLI access. Run `gh auth status` and retry.');
    }

    return {
      stdout: execaError.stdout ?? '',
      stderr: execaError.stderr ?? '',
      exitCode: execaError.exitCode
    };
  }
};

const STATE_LABEL_COLOR = 'C5DEF5';

interface IssueLabelsResponse {
  labels?: Array<{ name?: string }>;
}

function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function labelFor(state: WorkflowState): string {
  return `${STATE_LABEL_PREFIX}${state}`;
}

function parseState(label: string): WorkflowState | null {
  if (!label.startsWith(STATE_LABEL_PREFIX)) {
    return null;
  }
  const candidate = label.slice(STATE_LABEL_PREFIX.length);
  return (WORKFLOW_STATES as readonly string[]).includes(candidate)
    ? (candidate as WorkflowState)
    : null;
}

export class MultipleStateLabelsError extends Error {
  readonly issueNumber: number;
  readonly labels: string[];

  constructor(issueNumber: number, labels: string[]) {
    super(
      `Issue #${issueNumber} has multiple workflow state labels: ${labels.join(', ')}. Repair manually before retrying.`
    );
    this.name = 'MultipleStateLabelsError';
    this.issueNumber = issueNumber;
    this.labels = labels;
  }
}

export async function readState(
  repo: RepoRef,
  issueNumber: number,
  deps: StateStoreDeps = {}
): Promise<WorkflowState | null> {
  const gh = deps.gh ?? defaultRunner;
  const result = await gh([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--json',
    'labels'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to read labels for issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`);
  }

  const payload = JSON.parse(result.stdout || '{}') as IssueLabelsResponse;
  const states = (payload.labels ?? [])
    .map((label) => parseState(label.name ?? ''))
    .filter((value): value is WorkflowState => value !== null);

  if (states.length === 0) {
    return null;
  }

  if (states.length > 1) {
    throw new MultipleStateLabelsError(issueNumber, states);
  }

  return states[0];
}

async function createStateLabel(repo: RepoRef, state: WorkflowState, gh: GhRunner): Promise<void> {
  const result = await gh([
    'label',
    'create',
    labelFor(state),
    '--repo',
    repoSlug(repo),
    '--color',
    STATE_LABEL_COLOR,
    '--description',
    `FreeSolo workflow state: ${state}`,
    '--force'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create label ${labelFor(state)}: ${result.stderr.trim() || 'gh exited non-zero'}`);
  }
}

export async function writeState(
  repo: RepoRef,
  issueNumber: number,
  from: WorkflowState,
  to: WorkflowState,
  deps: StateStoreDeps = {}
): Promise<void> {
  assertTransition(from, to);

  if (from === to) {
    return;
  }

  const gh = deps.gh ?? defaultRunner;

  // `gh label create --force` is idempotent (creates or updates), so calling it
  // before every swap is cheap and removes the need to sniff `gh`'s error string
  // for a "label not found" condition (which varies across gh versions).
  await createStateLabel(repo, to, gh);

  const result = await gh([
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--remove-label',
    labelFor(from),
    '--add-label',
    labelFor(to)
  ]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to swap state labels on issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}

export async function ensureStateLabels(repo: RepoRef, deps: StateStoreDeps = {}): Promise<void> {
  const gh = deps.gh ?? defaultRunner;
  for (const state of WORKFLOW_STATES) {
    await createStateLabel(repo, state, gh);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/state-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/workflow/state-store.ts tests/unit/state-store.test.ts
git commit -m "Add gh-backed workflow state store"
```

---

## Task 3: State CLI Command Group

**Files:**
- Create: `src/commands/state.ts`
- Test: `tests/unit/state-command.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/state-command.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { registerStateCommands, type StateCommandDeps } from '../../src/commands/state.js';
import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import { MultipleStateLabelsError } from '../../src/workflow/state-store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: StateCommandDeps;
}

function buildHarness(overrides: Partial<StateCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: StateCommandDeps = {
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    readState: vi.fn().mockResolvedValue('triaged'),
    writeState: vi.fn().mockResolvedValue(undefined),
    env: { FREESOLO_ENGINE: '1' },
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    ...overrides
  };
  const program = new Command();
  program.exitOverride();
  registerStateCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('freesolo state get', () => {
  it('prints the current state when one exists', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue('implementing')
    });

    await program.parseAsync(['node', 'freesolo', 'state', 'get', '--issue', '17']);

    expect(deps.readState).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 17);
    expect(io.stdout).toEqual(['implementing\n']);
    expect(io.exitCode).toBeNull();
  });

  it('does not require FREESOLO_ENGINE for state get', async () => {
    const { program, io, deps } = buildHarness({
      env: {},
      readState: vi.fn().mockResolvedValue('implementing')
    });

    await program.parseAsync(['node', 'freesolo', 'state', 'get', '--issue', '17']);

    expect(deps.readState).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 17);
    expect(io.stdout).toEqual(['implementing\n']);
    expect(io.exitCode).toBeNull();
  });

  it('prints null and exits 2 when the issue has no state label', async () => {
    const { program, io } = buildHarness({
      readState: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync(['node', 'freesolo', 'state', 'get', '--issue', '17']);

    expect(io.stdout).toEqual(['null\n']);
    expect(io.exitCode).toBe(2);
  });

  it('reports a malformed state and exits 4', async () => {
    const { program, io } = buildHarness({
      readState: vi.fn().mockRejectedValue(new MultipleStateLabelsError(17, ['triaged', 'planned']))
    });

    await program.parseAsync(['node', 'freesolo', 'state', 'get', '--issue', '17']);

    expect(io.stdout).toEqual([]);
    expect(io.stderr.join('')).toContain('multiple workflow state labels');
    expect(io.exitCode).toBe(4);
  });
});

describe('freesolo state transition', () => {
  it('refuses to run without FREESOLO_ENGINE and exits 3', async () => {
    const { program, io, deps } = buildHarness({ env: {} });

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.readState).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(3);
    expect(io.stderr.join('')).toContain('FREESOLO_ENGINE');
  });

  it('reads the current state, validates, and writes the new state when gated', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged')
    });

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      17,
      'triaged',
      'planned'
    );
    expect(io.stdout.join('')).toBe('triaged -> planned\n');
    expect(io.exitCode).toBeNull();
  });

  it('rejects --to values outside the known states with a clear error and exit 1', async () => {
    const { program, io, deps } = buildHarness();

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'bogus'
    ]);

    expect(deps.readState).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Unknown state "bogus"');
  });

  it('refuses to transition from an uninitialised issue', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('has no current workflow state');
  });

  it('surfaces InvalidTransitionError with exit code 1', async () => {
    const writeState = vi.fn().mockRejectedValue(
      new InvalidTransitionError('triaged', 'merged', ['planned'])
    );
    const { program, io } = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged'),
      writeState
    });

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'merged'
    ]);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Invalid workflow transition: triaged → merged');
  });

  it('exits 4 when readState sees multiple state labels during transition', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockRejectedValue(new MultipleStateLabelsError(17, ['triaged', 'planned']))
    });

    await program.parseAsync([
      'node',
      'freesolo',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.stdout).toEqual([]);
    expect(io.exitCode).toBe(4);
    expect(io.stderr.join('')).toContain('multiple workflow state labels');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/unit/state-command.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the command module**

Create `src/commands/state.ts`:

```ts
import { Command, InvalidArgumentError, Option } from 'commander';

import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import {
  InvalidTransitionError,
  WORKFLOW_STATES,
  type WorkflowState
} from '../workflow/state-machine.js';
import {
  MultipleStateLabelsError,
  readState as defaultReadState,
  writeState as defaultWriteState,
  type RepoRef
} from '../workflow/state-store.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface StateCommandDeps {
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  writeState: (
    repo: RepoRef,
    issueNumber: number,
    from: WorkflowState,
    to: WorkflowState
  ) => Promise<void>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultResolveRepoRef(cwd: string): Promise<RepoRef> {
  const repoRoot = await resolveRepoRoot(cwd);
  const remoteUrl = await readOriginRemote(repoRoot);
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error('origin is not a supported GitHub remote');
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

const defaultDeps: StateCommandDeps = {
  resolveRepoRef: defaultResolveRepoRef,
  readState: defaultReadState,
  writeState: defaultWriteState,
  env: process.env,
  write: (channel, message) => {
    if (channel === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  }
};

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

function isKnownWorkflowState(value: string): value is WorkflowState {
  return (WORKFLOW_STATES as readonly string[]).includes(value);
}

function withCommanderErrorHandling(
  command: Command,
  deps: StateCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);

    if (error instanceof MultipleStateLabelsError) {
      deps.setExitCode(4);
      return;
    }

    deps.setExitCode(1);
  });
}

export function registerStateCommands(program: Command, deps: StateCommandDeps = defaultDeps): Command {
  const state = program
    .command('state')
    .description('Inspect and advance the FreeSolo workflow state for a GitHub issue');

  state
    .command('get')
    .description('Print the current workflow state for the given issue')
    .addOption(
      new Option('--issue <number>', 'Issue number to inspect')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .action(async (options: { issue: number }) => {
      await withCommanderErrorHandling(state, deps, async () => {
        const repo = await deps.resolveRepoRef(process.cwd());
        const current = await deps.readState(repo, options.issue);
        if (current === null) {
          deps.write('stdout', 'null\n');
          deps.setExitCode(2);
          return;
        }
        deps.write('stdout', `${current}\n`);
      });
    });

  state
    .command('transition')
    .description('Advance the workflow state for an issue (engine-only)')
    .addOption(
      new Option('--issue <number>', 'Issue number to transition')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .requiredOption('--to <state>', 'Target workflow state')
    .action(async (options: { issue: number; to: string }) => {
      if (deps.env.FREESOLO_ENGINE !== '1') {
        deps.write(
          'stderr',
          'freesolo state transition is engine-only. Set FREESOLO_ENGINE=1 to authorise the call; agent processes must not bypass the workflow engine.\n'
        );
        deps.setExitCode(3);
        return;
      }

      if (!isKnownWorkflowState(options.to)) {
        deps.write(
          'stderr',
          `Unknown state "${options.to}". Known states: ${WORKFLOW_STATES.join(', ')}.\n`
        );
        deps.setExitCode(1);
        return;
      }

      const target: WorkflowState = options.to;

      await withCommanderErrorHandling(state, deps, async () => {
        const repo = await deps.resolveRepoRef(process.cwd());
        const current = await deps.readState(repo, options.issue);
        if (current === null) {
          deps.write(
            'stderr',
            `Issue #${options.issue} has no current workflow state. Initialise it before transitioning.\n`
          );
          deps.setExitCode(1);
          return;
        }

        try {
          await deps.writeState(repo, options.issue, current, target);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            deps.write('stderr', `${error.message}\n`);
            deps.setExitCode(1);
            return;
          }
          throw error;
        }

        deps.write('stdout', `${current} -> ${target}\n`);
      });
    });

  return state;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/unit/state-command.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/state.ts tests/unit/state-command.test.ts
git commit -m "Add freesolo state CLI command group"
```

---

## Task 4: Wire State Commands Into the Program

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/unit/cli.test.ts`

- [ ] **Step 1: Add a failing CLI registration test**

Update `tests/unit/cli.test.ts` by appending the new assertion to the existing `describe('buildCli', ...)` block (keep the existing tests unchanged):

```ts
  it('registers the state command group with get and transition subcommands', () => {
    const program = buildCli();
    const stateCommand = program.commands.find((command) => command.name() === 'state');

    expect(stateCommand).toBeDefined();
    const subcommands = stateCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['get', 'transition']));
  });
```

- [ ] **Step 2: Run the failing test**

Run: `npm test -- tests/unit/cli.test.ts`

Expected: FAIL with `expect(stateCommand).toBeDefined()` reporting `undefined`.

- [ ] **Step 3: Register the state command group**

Modify `src/cli.ts` to import and call `registerStateCommands`. Replace the file with:

```ts
import { Command, Option } from 'commander';

import { startAction } from './commands/start.js';
import { registerStateCommands } from './commands/state.js';

export function buildCli(): Command {
  const program = new Command();

  program
    .name('freesolo')
    .description('Start focused issue sessions from the current repository');

  program
    .command('start')
    .description('Start or resume work for one assigned issue')
    .addOption(
      new Option('--tool <tool>', 'Host tool to launch')
        .choices(['codex', 'claude', 'cursor'])
        .makeOptionMandatory()
    )
    .option('--print-only', 'Print the derived actions without launching the host')
    .addHelpText(
      'after',
      `

Worktree setup:
  After creating or attaching a worktree, freesolo runs scripts/setup-new-worktree.sh
  from that worktree when it exists. The hook receives MAIN_REPO_ROOT pointing at
  the source checkout. Existing reused worktrees skip this hook.`
    )
    .action(startAction);

  registerStateCommands(program);

  return program;
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`

Expected: PASS — every file green, including the new `state-machine`, `state-store`, `state-command`, and updated `cli` suites.

- [ ] **Step 5: Run the TypeScript build**

Run: `npm run build`

Expected: `dist/` produced without errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/unit/cli.test.ts
git commit -m "Register freesolo state command group on the CLI"
```

---

## Task 5: Documentation Touch-Up

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a usage section for the state commands**

Insert the following markdown verbatim into `README.md`, immediately after the existing `## Usage` code block (the `cursor` example) and before the `## Worktree setup hooks` heading. The outer fence below uses tildes (`~~~markdown` / `~~~`) only so the inner triple-backtick `bash` block renders as part of the snippet — the tildes themselves are NOT part of what you paste; only the content between them is.

~~~markdown
### Workflow state

Inspect and advance the FreeSolo workflow state for a tracked issue:

```bash
freesolo state get --issue 17
# prints the current state, or "null" with exit code 2 when no state:* label is set

FREESOLO_ENGINE=1 freesolo state transition --issue 17 --to planned
# advances the state; the env var gates the transition so agent processes cannot bypass it
```

Valid states: `triaged`, `planned`, `approved`, `implementing`, `reviewing`, `verifying`, `pr-ready`, `merged`, `closed`. State is stored as a single `state:*` label on the GitHub issue.
~~~

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document freesolo state CLI"
```

---

## Verification Pass

After Task 5, run the full check the verification skill expects:

- `npm test` — every unit test green.
- `npm run build` — clean TypeScript build.

The acceptance criteria map back to the spec:

| Criterion                                                          | Verified by                                                                |
|--------------------------------------------------------------------|----------------------------------------------------------------------------|
| State stored in GitHub labels                                      | `state-store.test.ts` reads/writes the `state:` prefix via the `gh` API.   |
| Transitions explicit and enumerable                                | `state-machine.test.ts` drives all allowed pairs from `TRANSITIONS`.       |
| Agents cannot bypass states                                        | `state-command.test.ts` proves `FREESOLO_ENGINE` gating + exit code 3.    |
| Invalid transitions rejected with a clear error                    | `state-machine.test.ts` asserts `InvalidTransitionError` message + code 1. |
| State recoverable after restart                                    | `readState` is stateless and idempotent against the GitHub label store.    |
