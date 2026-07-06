# Agent Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add up-to-5-round review/fix loops to both freesolo review gates.

**Architecture:** Keep freesolo as an instruction-injection launcher rather than a runtime orchestrator, but move deterministic loop bookkeeping into a shared freesolo skill script usable by Codex and Claude Code. The CLI will initialize loop state, discover numbered review artifacts, and inject explicit loop instructions that tell the host agent to use the script before spawning fresh reviewer agents and separate fixer agents until a clean pass or round 5 block.

**Tech Stack:** TypeScript, Node.js 20, Zod, Vitest, markdown host integration assets.

---

## File Structure

- Modify `src/core/types.ts`: add review loop state types.
- Modify `src/core/session-state.ts`: validate and default `reviewLoops`.
- Modify `src/core/artifacts.ts`: prefer latest numbered review artifacts while preserving old names.
- Modify `src/workflow/kernel.ts`: replace single-pass gate language with shared review/fix loop instructions.
- Modify `src/commands/start.ts`: initialize loop state in new sessions.
- Create `integrations/skills/freesolo-workflow/scripts/review-loop.mjs`: provide the shared skill-local loop driver for round state, artifact paths, and reviewer/fixer handoff text.
- Create `tests/unit/review-loop-script.test.ts`: verify the skill script behavior through Node.
- Move and modify `integrations/codex/freesolo-workflow/SKILL.md` to `integrations/skills/freesolo-workflow/SKILL.md`: make the workflow skill canonical for Codex and Claude Code.
- Modify `integrations/claude/commands/freesolo.md`: mirror loop workflow for Claude.
- Modify `integrations/cursor/commands/freesolo.md`: mirror loop workflow for Cursor.
- Modify `README.md` and `docs/host-integrations.md`: document the shared skill path.
- Modify `tests/unit/session-state.test.ts`: cover new state and legacy defaults.
- Modify `tests/unit/artifacts.test.ts`: cover round-specific artifact discovery.
- Modify `tests/unit/workflow.test.ts`: cover loop instructions in startup prompt.
- Modify `tests/unit/integrations.test.ts`: cover loop instructions in host assets.
- Modify `tests/integration/start-command.test.ts`: cover initialized loop state.

## Task 1: Session State Loop Schema

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/session-state.ts`
- Test: `tests/unit/session-state.test.ts`

- [ ] **Step 1: Write failing session-state tests**

Update `tests/unit/session-state.test.ts` to assert both new loop fields and legacy defaults:

```ts
import { describe, expect, it } from 'vitest';

import { sessionStateSchema } from '../../src/core/session-state.js';

const baseState = {
  issueNumber: 12,
  issueSlug: 'ship-freesolo-start',
  repoRoot: '/repo',
  branchName: 'issue/12-ship-freesolo-start',
  worktreePath: '/tmp/freesolo-12-ship-freesolo-start',
  chosenHost: 'codex',
  currentStage: 'brainstorming',
  reviewGates: {
    plan: 'pending',
    implementation: 'pass'
  },
  createdAt: '2026-04-24T10:00:00.000Z',
  updatedAt: '2026-04-24T11:30:00.000Z',
  artifacts: {
    spec: null,
    plan: null,
    planReview: null,
    implementationReview: null
  }
};

describe('sessionStateSchema', () => {
  it('accepts the persisted freesolo state shape with review loops', () => {
    const parsed = sessionStateSchema.parse({
      ...baseState,
      reviewLoops: {
        plan: {
          currentRound: 2,
          maxRounds: 5
        },
        implementation: {
          currentRound: 1,
          maxRounds: 5
        }
      }
    });

    expect(parsed.currentStage).toBe('brainstorming');
    expect(parsed.reviewGates.plan).toBe('pending');
    expect(parsed.reviewLoops.plan.currentRound).toBe(2);
    expect(parsed.reviewLoops.implementation.maxRounds).toBe(5);
  });

  it('defaults review loops for existing session files', () => {
    const parsed = sessionStateSchema.parse(baseState);

    expect(parsed.reviewLoops).toEqual({
      plan: {
        currentRound: 1,
        maxRounds: 5
      },
      implementation: {
        currentRound: 1,
        maxRounds: 5
      }
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/session-state.test.ts`

Expected: FAIL because `reviewLoops` is not present in parsed state.

- [ ] **Step 3: Add review loop types**

Update `src/core/types.ts`:

```ts
export type HostTool = 'codex' | 'claude' | 'cursor';
export type ReviewGateStatus = 'pending' | 'pass' | 'pass_with_findings' | 'block';

export interface ReviewLoopState {
  currentRound: number;
  maxRounds: 5;
}

export interface ReviewLoopsState {
  plan: ReviewLoopState;
  implementation: ReviewLoopState;
}
```

Keep the rest of the existing exported interfaces below these definitions.

- [ ] **Step 4: Add schema defaults**

Update the imports and schema setup in `src/core/session-state.ts`:

```ts
import type { HostTool, ReviewGateStatus, ReviewLoopsState } from './types.js';

const reviewGateStatusValues = ['pending', 'pass', 'pass_with_findings', 'block'] as const;
const reviewGateStatusSchema = z.enum(reviewGateStatusValues) as z.ZodType<ReviewGateStatus>;
const defaultReviewLoops: ReviewLoopsState = {
  plan: {
    currentRound: 1,
    maxRounds: 5
  },
  implementation: {
    currentRound: 1,
    maxRounds: 5
  }
};
const reviewLoopSchema = z.object({
  currentRound: z.number().int().min(1).max(5).default(1),
  maxRounds: z.literal(5).default(5)
});
```

Add `reviewLoops` after `reviewGates` in `sessionStateSchema`:

```ts
  reviewLoops: z
    .object({
      plan: reviewLoopSchema.default(defaultReviewLoops.plan),
      implementation: reviewLoopSchema.default(defaultReviewLoops.implementation)
    })
    .default(defaultReviewLoops),
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/session-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/session-state.ts tests/unit/session-state.test.ts
git commit -m "Add review loop session state"
```

## Task 2: Numbered Review Artifact Discovery

**Files:**
- Modify: `src/core/artifacts.ts`
- Test: `tests/unit/artifacts.test.ts`

- [ ] **Step 1: Write failing artifact discovery tests**

Add these tests to `tests/unit/artifacts.test.ts`:

```ts
  it('prefers the latest numbered plan review artifact', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/freesolo/reviews'), { recursive: true });

    const oldPlanReviewPath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-21-issue-12-plan-review.md');
    const roundOnePath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-22-issue-12-plan-review-round-1.md');
    const roundTwoPath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-22-issue-12-plan-review-round-2.md');

    await fs.writeFile(oldPlanReviewPath, '# old review');
    await fs.writeFile(roundOnePath, '# round 1');
    await fs.writeFile(roundTwoPath, '# round 2');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.planReview).toBe(roundTwoPath);
  });

  it('prefers the latest numbered implementation review artifact', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/freesolo/reviews'), { recursive: true });

    const roundThreePath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-23-issue-12-implementation-review-round-3.md');
    const roundFourPath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-23-issue-12-implementation-review-round-4.md');

    await fs.writeFile(roundThreePath, '# round 3');
    await fs.writeFile(roundFourPath, '# round 4');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.implementationReview).toBe(roundFourPath);
  });

  it('keeps reading old unnumbered review artifact names', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/freesolo/reviews'), { recursive: true });

    const planReviewPath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-21-issue-12-plan-review.md');
    const implementationReviewPath = path.join(repoRoot, 'docs/freesolo/reviews/2026-04-22-issue-12-implementation-review.md');

    await fs.writeFile(planReviewPath, '# plan review');
    await fs.writeFile(implementationReviewPath, '# implementation review');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.planReview).toBe(planReviewPath);
    expect(artifacts.implementationReview).toBe(implementationReviewPath);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/artifacts.test.ts`

Expected: FAIL because numbered `*-round-*.md` review files are not discovered.

- [ ] **Step 3: Implement review artifact selection**

Update `src/core/artifacts.ts`:

```ts
type ReviewArtifactKind = 'plan' | 'implementation';

async function readDirectoryEntries(absoluteDir: string): Promise<string[] | null> {
  try {
    return await fs.readdir(absoluteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
```

Refactor `findLatestArtifact` to use `readDirectoryEntries`:

```ts
async function findLatestArtifact(repoRoot: string, relativeDir: string[], issueNumber: number, suffix: string): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, ...relativeDir);
  const entries = await readDirectoryEntries(absoluteDir);

  if (!entries) {
    return null;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const match = entries
    .filter((entry) => entry.includes(issueMarker) && entry.endsWith(suffix))
    .sort()
    .at(-1);

  return match ? path.join(absoluteDir, match) : null;
}
```

Add the numbered review finder:

```ts
async function findLatestReviewArtifact(repoRoot: string, issueNumber: number, kind: ReviewArtifactKind): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, 'docs', 'freesolo', 'reviews');
  const entries = await readDirectoryEntries(absoluteDir);

  if (!entries) {
    return null;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const numberedReview = entries
    .filter((entry) => entry.includes(issueMarker))
    .filter((entry) => entry.includes(`-${kind}-review-round-`))
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .at(-1);

  if (numberedReview) {
    return path.join(absoluteDir, numberedReview);
  }

  const legacyReview = entries
    .filter((entry) => entry.includes(issueMarker) && entry.endsWith(`-${kind}-review.md`))
    .sort()
    .at(-1);

  return legacyReview ? path.join(absoluteDir, legacyReview) : null;
}
```

Update `findIssueArtifacts`:

```ts
  const [spec, plan, planReview, implementationReview] = await Promise.all([
    findLatestArtifact(repoRoot, ['docs', 'freesolo', 'specs'], issueNumber, '-design.md'),
    findLatestArtifact(repoRoot, ['docs', 'freesolo', 'plans'], issueNumber, '-plan.md'),
    findLatestReviewArtifact(repoRoot, issueNumber, 'plan'),
    findLatestReviewArtifact(repoRoot, issueNumber, 'implementation')
  ]);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/artifacts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/artifacts.ts tests/unit/artifacts.test.ts
git commit -m "Discover numbered review artifacts"
```

## Task 3: Workflow Kernel Loop Instructions

**Files:**
- Modify: `src/workflow/kernel.ts`
- Test: `tests/unit/workflow.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Update the `buildWorkflowKernel` test in `tests/unit/workflow.test.ts`:

```ts
    expect(kernel).toContain('Plan Review/Fix Loop');
    expect(kernel).toContain('Implementation Review/Fix Loop');
    expect(kernel).toContain('up to 5 rounds');
    expect(kernel).toContain('fresh reviewer agent');
    expect(kernel).toContain('separate fixer agent');
    expect(kernel).toContain('passes with no findings');
    expect(kernel).toContain('Do not proceed after round 5');
```

Remove the old expectations for `Review Gate 1` and `Review Gate 2`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/workflow.test.ts`

Expected: FAIL because the kernel still contains single-pass review gates.

- [ ] **Step 3: Add shared review loop text**

Update `src/workflow/kernel.ts` with a helper near `formatList`:

```ts
export function buildReviewLoopInstructions(): string {
  return `Review/fix loop rules for both review gates:
- Run each review gate for up to 5 rounds.
- For each round, spawn a fresh reviewer agent.
- The reviewer writes a round-specific artifact under docs/freesolo/reviews using -round-<round>.md in the filename.
- If the reviewer passes with no findings, mark the gate as pass and continue.
- If the reviewer reports findings, mark the gate as pass_with_findings, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
- Do not proceed after round 5 if findings remain; mark the gate as block and ask the user how to proceed.`.trim();
}
```

Update the stage order in `buildWorkflowKernel`:

```ts
Required stage order:
1. Issue Intake
2. Brainstorming with superpowers:brainstorming
3. Spec
4. User Review Gate
5. Plan with superpowers:writing-plans
6. Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
7. Implementation with superpowers:test-driven-development
8. Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
9. Verification with superpowers:verification-before-completion

${buildReviewLoopInstructions()}

Use ...
Never skip the two review/fix loops.
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/kernel.ts tests/unit/workflow.test.ts
git commit -m "Describe review fix loops in kernel"
```

## Task 4: Initialize Loop State During Start

**Files:**
- Modify: `src/commands/start.ts`
- Test: `tests/integration/start-command.test.ts`

- [ ] **Step 1: Write failing start-command assertions**

In `tests/integration/start-command.test.ts`, extend the `states[0]` expectation in the test named `writes the full stage-1 packet and enriched session state when launching`:

```ts
      reviewLoops: {
        plan: {
          currentRound: 1,
          maxRounds: 5
        },
        implementation: {
          currentRound: 1,
          maxRounds: 5
        }
      },
```

Also add startup prompt assertions after the packet assertions:

```ts
    expect(result.mode).toBe('launch');
    if (result.mode === 'launch') {
      expect(result.launchPlan.args.join('\n')).toContain('Plan Review/Fix Loop');
      expect(result.launchPlan.args.join('\n')).toContain('Implementation Review/Fix Loop');
      expect(result.launchPlan.args.join('\n')).toContain('up to 5 rounds');
    }
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/integration/start-command.test.ts`

Expected: FAIL because new sessions do not write `reviewLoops` yet and the startup prompt still uses old gate names.

- [ ] **Step 3: Initialize review loop state**

In `src/commands/start.ts`, add `reviewLoops` to the state object passed to `deps.writeSessionState`:

```ts
      reviewLoops: {
        plan: {
          currentRound: 1,
          maxRounds: 5
        },
        implementation: {
          currentRound: 1,
          maxRounds: 5
        }
      },
```

Place it immediately after `reviewGates`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/integration/start-command.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/start.ts tests/integration/start-command.test.ts
git commit -m "Initialize review loop state"
```

## Task 5: Shared Skill Review Loop Script

**Files:**
- Create: `integrations/skills/freesolo-workflow/scripts/review-loop.mjs`
- Create: `tests/unit/review-loop-script.test.ts`

- [ ] **Step 1: Write failing script tests**

Create `tests/unit/review-loop-script.test.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const scriptPath = path.resolve('integrations/skills/freesolo-workflow/scripts/review-loop.mjs');
const scriptEnv = { FREESOLO_REVIEW_DATE: '2026-04-24' };

async function createRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-review-loop-'));
  tempDirs.push(repoRoot);

  await execa('git', ['init'], { cwd: repoRoot });
  const gitDir = path.join(repoRoot, '.git');
  await fs.mkdir(path.join(gitDir, 'freesolo'), { recursive: true });
  await fs.writeFile(
    path.join(gitDir, 'freesolo/session.json'),
    JSON.stringify(
      {
        issueNumber: 12,
        issueSlug: 'ship-freesolo-start',
        repoRoot,
        branchName: 'issue/12-ship-freesolo-start',
        worktreePath: repoRoot,
        chosenHost: 'codex',
        currentStage: 'plan-review',
        reviewGates: {
          plan: 'pending',
          implementation: 'pending'
        },
        reviewLoops: {
          plan: {
            currentRound: 1,
            maxRounds: 5
          },
          implementation: {
            currentRound: 1,
            maxRounds: 5
          }
        },
        createdAt: '2026-04-24T10:00:00.000Z',
        updatedAt: '2026-04-24T10:00:00.000Z',
        artifacts: {
          spec: `${repoRoot}/docs/freesolo/specs/2026-04-20-issue-12-design.md`,
          plan: `${repoRoot}/docs/freesolo/plans/2026-04-21-issue-12-plan.md`,
          planReview: null,
          implementationReview: null
        }
      },
      null,
      2
    )
  );

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('review-loop skill script', () => {
  it('prints reviewer handoff details for the current round', async () => {
    const repoRoot = await createRepo();

    const { stdout } = await execa('node', [scriptPath, 'next-review', '--gate', 'plan'], { cwd: repoRoot, env: scriptEnv });

    expect(stdout).toContain('Gate: plan');
    expect(stdout).toContain('Round: 1/5');
    expect(stdout).toContain('fresh reviewer agent');
    expect(stdout).toContain('docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md');
  });

  it('records findings and advances to the next round with fixer handoff details', async () => {
    const repoRoot = await createRepo();

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'pass_with_findings', '--artifact', 'docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md'],
      { cwd: repoRoot, env: scriptEnv }
    );

    const session = JSON.parse(await fs.readFile(path.join(repoRoot, '.git/freesolo/session.json'), 'utf8'));

    expect(stdout).toContain('spawn a separate fixer agent');
    expect(stdout).toContain('Next review round: 2/5');
    expect(session.reviewGates.plan).toBe('pass_with_findings');
    expect(session.reviewLoops.plan.currentRound).toBe(2);
    expect(session.artifacts.planReview).toBe(`${repoRoot}/docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md`);
  });

  it('blocks the gate when findings remain at round 5', async () => {
    const repoRoot = await createRepo();
    const sessionPath = path.join(repoRoot, '.git/freesolo/session.json');
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    session.reviewLoops.plan.currentRound = 5;
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'pass_with_findings', '--artifact', 'docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-5.md'],
      { cwd: repoRoot, env: scriptEnv }
    );
    const updatedSession = JSON.parse(await fs.readFile(sessionPath, 'utf8'));

    expect(stdout).toContain('Do not proceed after round 5');
    expect(updatedSession.reviewGates.plan).toBe('block');
    expect(updatedSession.reviewLoops.plan.currentRound).toBe(5);
  });

  it('passes the gate when review status is pass', async () => {
    const repoRoot = await createRepo();

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'implementation', '--status', 'pass', '--artifact', 'docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md'],
      { cwd: repoRoot, env: scriptEnv }
    );
    const session = JSON.parse(await fs.readFile(path.join(repoRoot, '.git/freesolo/session.json'), 'utf8'));

    expect(stdout).toContain('Gate passed with no findings');
    expect(session.reviewGates.implementation).toBe('pass');
    expect(session.artifacts.implementationReview).toBe(`${repoRoot}/docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md`);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/review-loop-script.test.ts`

Expected: FAIL because `integrations/skills/freesolo-workflow/scripts/review-loop.mjs` does not exist.

- [ ] **Step 3: Implement the skill script**

Create `integrations/skills/freesolo-workflow/scripts/review-loop.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const gates = new Set(['plan', 'implementation']);
const statuses = new Set(['pass', 'pass_with_findings', 'block']);
const maxRounds = 5;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];

    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }

    args[key.slice(2)] = value;
  }

  return args;
}

function assertGate(gate) {
  if (!gates.has(gate)) {
    throw new Error(`Invalid gate "${gate}". Use "plan" or "implementation".`);
  }
}

function assertStatus(status) {
  if (!statuses.has(status)) {
    throw new Error(`Invalid status "${status}". Use "pass", "pass_with_findings", or "block".`);
  }
}

async function resolveGitPath(name) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', `freesolo/${name}`]);
  return stdout.trim();
}

async function readSession() {
  const sessionPath = await resolveGitPath('session.json');
  const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));

  session.reviewLoops ??= {
    plan: { currentRound: 1, maxRounds },
    implementation: { currentRound: 1, maxRounds }
  };
  session.reviewLoops.plan ??= { currentRound: 1, maxRounds };
  session.reviewLoops.implementation ??= { currentRound: 1, maxRounds };

  return { sessionPath, session };
}

function reviewKind(gate) {
  return gate === 'plan' ? 'plan' : 'implementation';
}

function artifactKey(gate) {
  return gate === 'plan' ? 'planReview' : 'implementationReview';
}

function datedReviewArtifact(session, gate, round) {
  const date = process.env.FREESOLO_REVIEW_DATE ?? new Date().toISOString().slice(0, 10);
  const filename = `${date}-issue-${session.issueNumber}-${reviewKind(gate)}-review-round-${round}.md`;
  return path.join(session.repoRoot, 'docs', 'freesolo', 'reviews', filename);
}

async function writeSession(sessionPath, session) {
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
}

async function nextReview(gate) {
  assertGate(gate);
  const { session } = await readSession();
  const loop = session.reviewLoops[gate];
  const artifactPath = datedReviewArtifact(session, gate, loop.currentRound);

  console.log(`Gate: ${gate}`);
  console.log(`Round: ${loop.currentRound}/${loop.maxRounds}`);
  console.log(`Review artifact: ${artifactPath}`);
  console.log(`Spawn a fresh reviewer agent for ${gate} review round ${loop.currentRound}.`);
  console.log('The reviewer must write findings to the review artifact and return status pass, pass_with_findings, or block.');
}

async function recordReview(gate, status, artifact) {
  assertGate(gate);
  assertStatus(status);

  if (!artifact) {
    throw new Error('Missing --artifact path');
  }

  const { sessionPath, session } = await readSession();
  const loop = session.reviewLoops[gate];
  const absoluteArtifact = path.isAbsolute(artifact) ? artifact : path.join(session.repoRoot, artifact);

  session.reviewGates[gate] = status;
  session.artifacts[artifactKey(gate)] = absoluteArtifact;

  if (status === 'pass') {
    await writeSession(sessionPath, session);
    console.log('Gate passed with no findings. Continue to the next stage.');
    return;
  }

  if (status === 'block' || loop.currentRound >= maxRounds) {
    session.reviewGates[gate] = 'block';
    loop.currentRound = maxRounds;
    await writeSession(sessionPath, session);
    console.log('Do not proceed after round 5 if findings remain. Gate is blocked; ask the user how to proceed.');
    return;
  }

  session.reviewGates[gate] = 'pass_with_findings';
  loop.currentRound += 1;
  await writeSession(sessionPath, session);
  console.log(`Findings recorded from ${absoluteArtifact}.`);
  console.log('Spawn a separate fixer agent with the review artifact as input.');
  console.log(`Next review round: ${loop.currentRound}/${loop.maxRounds}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'next-review') {
    await nextReview(args.gate);
    return;
  }

  if (args.command === 'record-review') {
    await recordReview(args.gate, args.status, args.artifact);
    return;
  }

  throw new Error('Use "next-review" or "record-review".');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/review-loop-script.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add integrations/skills/freesolo-workflow/scripts/review-loop.mjs tests/unit/review-loop-script.test.ts
git commit -m "Add shared review loop script"
```

## Task 6: Host Integration Assets

**Files:**
- Move: `integrations/codex/freesolo-workflow/SKILL.md` to `integrations/skills/freesolo-workflow/SKILL.md`
- Modify: `integrations/claude/commands/freesolo.md`
- Modify: `integrations/cursor/commands/freesolo.md`
- Modify: `README.md`
- Modify: `docs/host-integrations.md`
- Test: `tests/unit/integrations.test.ts`

- [ ] **Step 1: Write failing integration asset test**

Update `requiredSnippets` in `tests/unit/integrations.test.ts`:

```ts
const assetFiles = [
  'integrations/skills/freesolo-workflow/SKILL.md',
  'integrations/claude/commands/freesolo.md',
  'integrations/cursor/commands/freesolo.md'
];

const requiredSnippets = [
  'git rev-parse --git-path freesolo/current-issue.md',
  'git rev-parse --git-path freesolo/session.json',
  'Issue Intake',
  'Brainstorming',
  'Spec',
  'User Review Gate',
  'Plan',
  'Plan Review/Fix Loop',
  'Implementation',
  'Implementation Review/Fix Loop',
  'Verification',
  'fresh reviewer agent',
  'separate fixer agent',
  'up to 5 rounds',
  'Do not proceed after round 5',
  'scripts/review-loop.mjs'
];
```

Update `orderedSnippets`:

```ts
      const orderedSnippets = [
        'Issue Intake',
        'Brainstorming',
        'Spec',
        'User Review Gate',
        'Plan',
        'Plan Review/Fix Loop',
        'Implementation',
        'Implementation Review/Fix Loop',
        'Verification'
      ];
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/integrations.test.ts`

Expected: FAIL because host assets still mention `Review Gate 1` and `Review Gate 2`.

- [ ] **Step 3: Update Codex skill asset**

Move `integrations/codex/freesolo-workflow/SKILL.md` to `integrations/skills/freesolo-workflow/SKILL.md`, then replace its stage list and gate language with:

```md
3. Continue the stage order exactly:
   - Issue Intake
   - Brainstorming with `superpowers:brainstorming`
   - Spec
   - User Review Gate
   - Plan with `superpowers:writing-plans`
   - Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
   - Implementation with `superpowers:test-driven-development`
   - Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
   - Verification with `superpowers:verification-before-completion`
4. For hosts that support skills, use the skill script for review loop bookkeeping:
   - Run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate plan` before each plan review round.
   - After a plan review with findings, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate plan --status pass_with_findings --artifact docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md`.
   - After a clean plan review, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate plan --status pass --artifact docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md`.
   - Run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate implementation` before each implementation review round.
   - After an implementation review with findings, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate implementation --status pass_with_findings --artifact docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md`.
   - After a clean implementation review, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate implementation --status pass --artifact docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md`.
5. Review/fix loop rules for both review gates:
   - Run each review gate for up to 5 rounds.
   - For each round, spawn a fresh reviewer agent.
   - The reviewer writes a round-specific artifact under `docs/freesolo/reviews` using `-round-<round>.md` in the filename.
   - If the reviewer passes with no findings, mark the gate as `pass` and continue.
   - If the reviewer reports findings, mark the gate as `pass_with_findings`, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
   - Do not proceed after round 5 if findings remain; mark the gate as `block` and ask the user how to proceed.
6. Never skip the two review/fix loops.
7. If the issue packet is missing, stop and ask the user to run `freesolo start`.
```

- [ ] **Step 4: Update Claude command asset**

Replace the task stage list and gate language in `integrations/claude/commands/freesolo.md` with:

```md
Continue the freesolo workflow in this order:
1. Issue Intake
2. Brainstorming with `superpowers:brainstorming`
3. Spec
4. User Review Gate
5. Plan with `superpowers:writing-plans`
6. Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
7. Implementation with `superpowers:test-driven-development`
8. Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
9. Verification with `superpowers:verification-before-completion`

Review/fix loop rules for both review gates:
- Run each review gate for up to 5 rounds.
- For each round, spawn a fresh reviewer agent.
- The reviewer writes a round-specific artifact under `docs/freesolo/reviews` using `-round-<round>.md` in the filename.
- If the reviewer passes with no findings, mark the gate as `pass` and continue.
- If the reviewer reports findings, mark the gate as `pass_with_findings`, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
- Do not proceed after round 5 if findings remain; mark the gate as `block` and ask the user how to proceed.

Never skip the two review/fix loops.
```

- [ ] **Step 5: Update Cursor command asset**

Replace the stage list and gate language in `integrations/cursor/commands/freesolo.md` with the same stage order and review/fix loop rules used in the Claude command asset.

- [ ] **Step 6: Update shared skill documentation**

In `README.md`, replace the Codex-specific reusable asset bullet:

```md
- `integrations/skills/freesolo-workflow/SKILL.md`
```

In `docs/host-integrations.md`, update the skill path references from `integrations/codex/freesolo-workflow/SKILL.md` to:

```md
integrations/skills/freesolo-workflow/SKILL.md
```

Expected: documentation points at the shared skill directory for hosts that support skills.

- [ ] **Step 7: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/integrations.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/host-integrations.md integrations/codex/freesolo-workflow/SKILL.md integrations/skills/freesolo-workflow/SKILL.md integrations/claude/commands/freesolo.md integrations/cursor/commands/freesolo.md tests/unit/integrations.test.ts
git commit -m "Update host assets for review loops"
```

## Task 7: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS for all Vitest suites.

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`

Expected: `tsc` completes without type errors and `scripts/ensure-bin-executable.mjs` completes successfully.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: clean working tree after commits, or only intentional uncommitted changes if the user requested no commits during execution.

- [ ] **Step 4: Commit verification-only changes if any were required**

If verification forced a small correction, commit it:

Use exact paths in the `git add` command. For example, if the verification correction is in the workflow kernel, run:

```bash
git add src/workflow/kernel.ts tests/unit/workflow.test.ts
git commit -m "Fix review loop verification"
```

Expected: no commit is needed when Tasks 1-6 were implemented exactly and tests/build pass.

## Self-Review Notes

- Spec coverage: Tasks cover loop instructions, max rounds, fresh reviewers, separate fixers, block after round 5, numbered artifacts, backwards-compatible artifact discovery, session defaults, the shared skill script, host assets, documentation, and tests.
- Type consistency: `reviewLoops.plan.currentRound`, `reviewLoops.plan.maxRounds`, `reviewLoops.implementation.currentRound`, and `reviewLoops.implementation.maxRounds` are used consistently.
- Scope: The plan intentionally avoids runtime host-specific agent orchestration. That belongs in a later CLI-orchestrated agents design if freesolo should spawn agents itself.
