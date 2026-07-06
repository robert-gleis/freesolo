# Worktrunk-Native Freesolo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `freesolo start` require Worktrunk and use `wt switch` as the only worktree creation and branch switching backend.

**Architecture:** Keep issue selection, branch naming, reuse prompts, setup hooks, session files, and host adapters in freesolo. Move mutating workspace operations to Worktrunk helpers in `src/core/worktree.ts`, then resolve the actual checkout path from `git worktree list --porcelain` after `wt switch` completes. Print-only mode renders Worktrunk commands and avoids pretending to know Worktrunk's configured path for new checkouts.

**Tech Stack:** TypeScript, Node.js 20+, execa, commander, inquirer, Vitest, Worktrunk `wt` CLI, Git read-only worktree state queries.

---

## File Structure

- Modify `src/core/worktree.ts`: add Worktrunk availability and command helpers, add branch path resolution, remove direct `git worktree add` mutation helpers, and preserve read-only branch/worktree listing and setup hook behavior.
- Modify `src/commands/start.ts`: require Worktrunk, call `wt switch` helpers, resolve actual paths after switching, update print-only workspace plans and summary lines, and catch Worktrunk-specific errors.
- Modify `tests/unit/worktree.test.ts`: replace direct git worktree creation tests with focused Worktrunk helper and branch path resolution tests.
- Modify `tests/integration/start-command.test.ts`: update dependency injection and expectations for Worktrunk-native create/switch/path-resolution behavior.
- Modify `README.md`: list Worktrunk as a prerequisite and describe Worktrunk-owned worktree placement.
- Optionally modify `docs/host-integrations.md` only if README wording reveals host docs need a matching prerequisite note.

---

### Task 1: Worktrunk Helper API

**Files:**
- Modify: `src/core/worktree.ts`
- Test: `tests/unit/worktree.test.ts`

- [ ] **Step 1: Write failing unit tests for Worktrunk helpers and branch path resolution**

Add imports in `tests/unit/worktree.test.ts`:

```ts
import {
  WorktrunkMissingError,
  WorktrunkPathResolutionError,
  ensureWorktrunkAvailable,
  resolveBranchWorktreePath,
  switchExistingIssueWorktree,
  switchNewIssueWorktree
} from '../../src/core/worktree.js';
```

Add tests with an injected runner:

```ts
describe('ensureWorktrunkAvailable', () => {
  it('returns when wt is available', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await expect(
      ensureWorktrunkAvailable(async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd });
      })
    ).resolves.toBeUndefined();

    expect(calls).toEqual([{ command: 'wt', args: ['--version'], cwd: undefined }]);
  });

  it('throws a clear error when wt is missing', async () => {
    await expect(
      ensureWorktrunkAvailable(async () => {
        const error = new Error('spawn wt ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      })
    ).rejects.toMatchObject({
      name: 'WorktrunkMissingError',
      message: expect.stringContaining('Worktrunk is required')
    } satisfies Partial<WorktrunkMissingError>);
  });
});

describe('Worktrunk switch helpers', () => {
  it('creates a new issue workspace through wt switch --create', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await switchNewIssueWorktree('/repo', 'issue/12-ship-freesolo-start', async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
    });

    expect(calls).toEqual([
      {
        command: 'wt',
        args: ['switch', '--create', 'issue/12-ship-freesolo-start'],
        cwd: '/repo'
      }
    ]);
  });

  it('switches an existing issue branch through wt switch', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await switchExistingIssueWorktree('/repo', 'issue/12-ship-freesolo-start', async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
    });

    expect(calls).toEqual([
      {
        command: 'wt',
        args: ['switch', 'issue/12-ship-freesolo-start'],
        cwd: '/repo'
      }
    ]);
  });
});

describe('resolveBranchWorktreePath', () => {
  it('returns the worktree path for a branch', async () => {
    const path = await resolveBranchWorktreePath('/repo', 'issue/12-ship-freesolo-start', async () => ({
      stdout: [
        'worktree /repo',
        'HEAD 1111111',
        'branch refs/heads/main',
        '',
        'worktree /worktrees/freesolo/12',
        'HEAD 2222222',
        'branch refs/heads/issue/12-ship-freesolo-start'
      ].join('\n')
    }));

    expect(path).toBe('/worktrees/freesolo/12');
  });

  it('throws when the branch has no resolved worktree', async () => {
    await expect(
      resolveBranchWorktreePath('/repo', 'issue/12-ship-freesolo-start', async () => ({
        stdout: ['worktree /repo', 'HEAD 1111111', 'branch refs/heads/main'].join('\n')
      }))
    ).rejects.toMatchObject({
      name: 'WorktrunkPathResolutionError',
      message: expect.stringContaining('Could not resolve Worktrunk checkout')
    } satisfies Partial<WorktrunkPathResolutionError>);
  });
});
```

- [ ] **Step 2: Run the focused unit tests and verify they fail**

Run:

```bash
npm test -- tests/unit/worktree.test.ts
```

Expected: FAIL because the new Worktrunk exports do not exist.

- [ ] **Step 3: Implement the Worktrunk helper API**

In `src/core/worktree.ts`, add a runner type and exported errors:

```ts
type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<unknown> | unknown;

type StdoutCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<{ stdout: string }> | { stdout: string };

const defaultCommandRunner: CommandRunner = (command, args, options) => execa(command, args, options);

const defaultStdoutRunner: StdoutCommandRunner = async (command, args, options) => {
  const { stdout } = await execa(command, args, options);
  return { stdout };
};

export class WorktrunkMissingError extends Error {
  constructor() {
    super('Worktrunk is required for freesolo start. Install wt from https://worktrunk.dev/worktrunk/ and try again.');
    this.name = 'WorktrunkMissingError';
  }
}

export class WorktrunkPathResolutionError extends Error {
  constructor(branchName: string) {
    super(`Could not resolve Worktrunk checkout for branch ${branchName}.`);
    this.name = 'WorktrunkPathResolutionError';
  }
}
```

Add helper functions:

```ts
function isMissingExecutableError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function ensureWorktrunkAvailable(runner: CommandRunner = defaultCommandRunner): Promise<void> {
  try {
    await runner('wt', ['--version']);
  } catch (error) {
    if (isMissingExecutableError(error)) {
      throw new WorktrunkMissingError();
    }

    throw error;
  }
}

export async function switchNewIssueWorktree(
  repoRoot: string,
  branchName: string,
  runner: CommandRunner = defaultCommandRunner
): Promise<void> {
  await runner('wt', ['switch', '--create', branchName], { cwd: repoRoot });
}

export async function switchExistingIssueWorktree(
  repoRoot: string,
  branchName: string,
  runner: CommandRunner = defaultCommandRunner
): Promise<void> {
  await runner('wt', ['switch', branchName], { cwd: repoRoot });
}

export async function resolveBranchWorktreePath(
  repoRoot: string,
  branchName: string,
  runner: StdoutCommandRunner = defaultStdoutRunner
): Promise<string> {
  const { stdout } = await runner('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  const match = parseWorktreeEntries(stdout).find((entry) => entry.branchName === branchName);

  if (!match?.worktreePath) {
    throw new WorktrunkPathResolutionError(branchName);
  }

  return match.worktreePath;
}
```

Extract the current `listWorktreeEntries` parsing into:

```ts
function parseWorktreeEntries(stdout: string): WorktreeEntry[] {
  const chunks = stdout.trim().split('\n\n').filter(Boolean);

  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const worktreePath = lines[0].replace(/^worktree /, '');
    const branchName = lines.find((line) => line.startsWith('branch '))?.replace(/^branch refs\/heads\//, '') ?? '';

    return { branchName, worktreePath };
  });
}
```

Then make `listWorktreeEntries` call `parseWorktreeEntries(stdout)`.

Remove exports for `createIssueWorktree`, `attachExistingBranchToWorktree`, and `ISSUE_BRANCH_START_POINT` after call sites are migrated in later tasks.

- [ ] **Step 4: Run focused unit tests and verify they pass**

Run:

```bash
npm test -- tests/unit/worktree.test.ts
```

Expected: PASS.

---

### Task 2: Start Command Worktrunk Flow

**Files:**
- Modify: `src/commands/start.ts`
- Test: `tests/integration/start-command.test.ts`

- [ ] **Step 1: Write failing integration tests for Worktrunk-native planning**

Update `StartPlanDeps` test objects to provide:

```ts
ensureWorktrunkAvailable: async () => undefined,
switchNewIssueWorktree: async () => undefined,
switchExistingIssueWorktree: async () => undefined,
resolveBranchWorktreePath: async (_repoRoot: string, branchName: string) => `/wt/${branchName.replaceAll('/', '-')}`
```

Replace old `createIssueWorktree` and `attachExistingBranchToWorktree` dependencies.

Update the print-only test expectation:

```ts
expect(result.workspacePlan.action).toBe('create-worktree');
expect(result.workspacePlan.setupCommands).toEqual([
  'wt switch --create issue/12-ship-freesolo-start',
  'Worktree path will be resolved by Worktrunk when executed.'
]);
expect(result.summaryLines).toContain('Worktree: resolved by Worktrunk');
```

Add a missing dependency test:

```ts
it('fails before workspace mutation when Worktrunk is missing', async () => {
  const calls: string[] = [];

  await expect(
    createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
      },
      {
        resolveRepoRoot: async () => '/repo',
        readOriginRemote: async () => 'git@github.com:robert-gleis/freesolo.git',
        ensureWorktrunkAvailable: async () => {
          throw new WorktrunkMissingError();
        },
        listAssignedIssues: async () => {
          calls.push('issues');
          return [];
        },
        listLocalBranches: async () => {
          calls.push('branches');
          return [];
        },
        listWorktreeEntries: async () => {
          calls.push('worktrees');
          return [];
        },
        switchNewIssueWorktree: async () => {
          calls.push('switch-new');
        },
        switchExistingIssueWorktree: async () => {
          calls.push('switch-existing');
        },
        resolveBranchWorktreePath: async () => {
          calls.push('resolve-path');
          return '/wt/path';
        },
        findIssueArtifacts: async () => ({ spec: null, plan: null, planReview: null, implementationReview: null }),
        writeSessionState: async () => undefined,
        writeIssuePacket: async () => undefined,
        chooseIssue: async () => {
          throw new Error('should not be called');
        },
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    )
  ).rejects.toMatchObject({ name: 'WorktrunkMissingError' });

  expect(calls).toEqual([]);
});
```

Update the create flow test to expect calls:

```ts
expect(calls).toEqual([
  'wt-check',
  'switch-new:/repo:issue/12-ship-freesolo-start',
  'resolve:/repo:issue/12-ship-freesolo-start',
  'setup:/repo:/wt/issue-12-ship-freesolo-start',
  'artifacts:/wt/issue-12-ship-freesolo-start'
]);
```

Update the existing branch flow test to expect `switch-existing` before resolve and artifact lookup.

- [ ] **Step 2: Run the integration tests and verify they fail**

Run:

```bash
npm test -- tests/integration/start-command.test.ts
```

Expected: FAIL because `createStartPlan` still uses direct git worktree dependencies and sibling paths.

- [ ] **Step 3: Modify `src/commands/start.ts` dependency interfaces and defaults**

Replace imports from `src/core/worktree.ts`:

```ts
import {
  buildBranchName,
  buildSiblingWorktreePath,
  ensureUniqueWorkspaceNames,
  ensureWorktrunkAvailable,
  findExistingWorkspaceMatch,
  listLocalBranches,
  listWorktreeEntries,
  resolveBranchWorktreePath,
  runWorktreeSetup,
  switchExistingIssueWorktree,
  switchNewIssueWorktree,
  WorktreeSetupError,
  WorktrunkMissingError,
  WorktrunkPathResolutionError,
  WORKTREE_SETUP_SCRIPT
} from '../core/worktree.js';
```

Update `StartPlanDeps`:

```ts
ensureWorktrunkAvailable: () => Promise<void>;
switchNewIssueWorktree: (repoRoot: string, branchName: string) => Promise<void>;
switchExistingIssueWorktree: (repoRoot: string, branchName: string) => Promise<void>;
resolveBranchWorktreePath: (repoRoot: string, branchName: string) => Promise<string>;
```

Remove:

```ts
createIssueWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
attachExistingBranchToWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
```

Set `defaultDeps` to the new helpers.

- [ ] **Step 4: Update workspace planning and execution**

Change workspace command renderers:

```ts
function buildCreateWorktreePlan(branchName: string): WorkspacePlan {
  return {
    action: 'create-worktree',
    setupCommands: [
      renderCommand(['wt', 'switch', '--create', branchName]),
      'Worktree path will be resolved by Worktrunk when executed.'
    ]
  };
}

function buildSwitchBranchPlan(branchName: string): WorkspacePlan {
  return {
    action: 'attach-branch-worktree',
    setupCommands: [
      renderCommand(['wt', 'switch', branchName]),
      'Worktree path will be resolved by Worktrunk when executed.'
    ]
  };
}
```

At the start of `createStartPlan`, after `rootDir` is known and before GitHub issue listing:

```ts
await deps.ensureWorktrunkAvailable();
```

For real create flow:

```ts
await deps.switchNewIssueWorktree(rootDir, branchName);
worktreePath = await deps.resolveBranchWorktreePath(rootDir, branchName);
shouldRunSetup = true;
```

For real existing branch flow:

```ts
await deps.switchExistingIssueWorktree(rootDir, branchName);
worktreePath = await deps.resolveBranchWorktreePath(rootDir, branchName);
shouldRunSetup = true;
```

For print-only create or switch flow, leave `worktreePath` as an empty string or known existing path. When `worktreePath` is unknown, `buildPrintOnlySummary` must render:

```ts
`Worktree: resolved by Worktrunk`
```

Do not run setup or artifact discovery from an unknown path in print-only. For print-only with unknown path, use the source checkout for adapter construction only if needed to avoid path-null errors, but summary must make clear that the launch path is resolved by Worktrunk at execution time. Prefer a placeholder string such as `'<worktrunk-checkout>'` only inside launch summaries.

- [ ] **Step 5: Catch Worktrunk errors in `startAction`**

Change the catch block:

```ts
if (
  error instanceof WorktreeSetupError ||
  error instanceof WorktrunkMissingError ||
  error instanceof WorktrunkPathResolutionError
) {
  console.error(error.message);
  process.exitCode = 1;
  return;
}
```

- [ ] **Step 6: Run integration tests and verify they pass**

Run:

```bash
npm test -- tests/integration/start-command.test.ts
```

Expected: PASS.

---

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Test: `tests/unit/integrations.test.ts` if it already checks README or docs content; otherwise rely on full test suite and manual diff review.

- [ ] **Step 1: Update README prerequisite text**

Change prerequisites to:

```md
- Node.js 20+
- `gh` installed and authenticated
- Worktrunk (`wt`) installed; freesolo delegates worktree creation and placement to Worktrunk
- At least one supported host installed: Codex, Claude, or Cursor Agent (`cursor-agent`)
```

- [ ] **Step 2: Update worktree setup hook docs**

Replace the first paragraph under `## Worktree setup hooks` with:

```md
`freesolo start` uses Worktrunk (`wt`) to create or switch issue worktrees. Worktree paths follow your Worktrunk configuration rather than freesolo's own sibling-directory convention.

After Worktrunk creates or attaches a new worktree, `freesolo` runs `scripts/setup-new-worktree.sh` from that worktree when the script exists. The hook is optional; repositories that do not define it continue without setup. The hook receives `MAIN_REPO_ROOT` pointing at the source checkout so repo-specific scripts can reference files that should not be copied automatically.
```

Update the print-only sentence:

```md
Existing worktrees are reused as-is and do not run the setup hook. `--print-only` shows the `wt switch` command that would run and notes when Worktrunk must resolve the final checkout path at execution time.
```

- [ ] **Step 3: Run docs-related tests**

Run:

```bash
npm test -- tests/unit/integrations.test.ts
```

Expected: PASS.

---

### Task 4: Full Verification and Cleanup

**Files:**
- Modify only files needed to fix failures discovered by verification.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run the build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff for accidental direct worktree backend leftovers**

Run:

```bash
grep -R "git.*worktree add\\|ISSUE_BRANCH_START_POINT\\|createIssueWorktree\\|attachExistingBranchToWorktree" -n src tests README.md docs || true
```

Expected: no remaining direct worktree mutation references except historical design/spec text if intentionally present.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add src/core/worktree.ts src/commands/start.ts tests/unit/worktree.test.ts tests/integration/start-command.test.ts README.md docs/superpowers/plans/2026-05-08-worktrunk-native.md
git commit -m "Require Worktrunk for issue worktrees"
```

Expected: commit succeeds.
