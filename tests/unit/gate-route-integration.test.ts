import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { gateEvaluateAction, type GateCommandDeps } from '../../src/commands/gate.js';
import { assertPrGate } from '../../src/commands/pr.js';
import { runGateRoute, type GateRouteDeps } from '../../src/verification/route-runner.js';
import { getRunDirectory, loadLatestRun } from '../../src/verification/store.js';
import {
  readGateVerdictRecord,
  writeGateVerdictRecord,
  type VerdictStatus
} from '../../src/verification/verdict-store.js';
import type { GateRouteConfig } from '../../src/verification/types.js';
import { assertTransition, type WorkflowState } from '../../src/workflow/state-machine.js';
import type { RepoRef } from '../../src/workflow/state-store.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
const ISSUE = 42;
const RUN_ID = '2026-07-03T11-00-00-000Z';

const worktrees: string[] = [];

async function makeGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-gate-integ-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/**
 * A minimal state store that enforces the REAL state machine (assertTransition),
 * so the integration test proves the genuine transition path rather than a no-op.
 * Kept in-memory to stay isolated from the developer's ~/.issueflow local store.
 */
function makeStateStore(initial: WorkflowState) {
  let current: WorkflowState = initial;
  return {
    readState: async (): Promise<WorkflowState | null> => current,
    writeState: async (
      _repo: RepoRef,
      _issue: number,
      from: WorkflowState,
      to: WorkflowState
    ): Promise<void> => {
      // The state machine is the authority; an illegal jump throws here.
      assertTransition(from, to);
      if (from !== current) {
        throw new Error(`state store drift: expected ${current}, got from=${from}`);
      }
      current = to;
    },
    get: () => current
  };
}

function makeConfig(): GateRouteConfig {
  return {
    maxAttempts: 2,
    bail: true,
    checks: [{ name: 'build', kind: 'shell', command: 'build-cmd', args: [], env: {} }],
    fixer: { host: 'codex', promptPreset: 'gate-fixer' }
  };
}

function makeMonotonicNow(): () => Date {
  const baseMs = Date.parse('2026-07-03T11:00:00.000Z');
  let tick = 0;
  return () => new Date(baseMs + tick++ * 1000);
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Gate Route state path integration', () => {
  it('drives implementing -> verifying -> pr-ready through a real route run, fixer, and gate evaluation', async () => {
    const repoRoot = await makeGitRepo();
    const store = makeStateStore('implementing');

    // Pre-gate transitions along the real state machine: implementing must reach
    // verifying before the gate may evaluate. These use the same authority the
    // gate command uses (assertTransition inside writeState).
    await store.writeState(repo, ISSUE, 'implementing', 'reviewing');
    await store.writeState(repo, ISSUE, 'reviewing', 'verifying');
    expect(store.get()).toBe('verifying');

    // Fail-then-fix-then-pass: attempt 1's shell check fails, the fake fixer
    // "fixes" it, attempt 2 passes. This exercises the fixer seam and the
    // whole-route rerun, then persists a REAL run.json via the real store.writeRun.
    let attempt = 0;
    const routeDeps: GateRouteDeps = {
      execCheck: async () => (attempt === 0 ? { exitCode: 1, signal: null } : { exitCode: 0, signal: null }),
      runAgentReview: async () => ({ status: 'pass', artifactPath: null, findings: null }),
      runFixer: async () => {
        attempt += 1;
        return { status: 'pass', detail: 'fixed', log: '' };
      },
      // Persist through the real store so loadLatestRun below round-trips run.json.
      writeRun: async (run) => {
        const { writeRun } = await import('../../src/verification/store.js');
        await writeRun(run);
      },
      now: makeMonotonicNow()
    };

    const runDirectory = await getRunDirectory(repoRoot, ISSUE, RUN_ID);
    const run = await runGateRoute(
      {
        config: makeConfig(),
        routeConfigPath: path.join(repoRoot, 'issueflow.config.json'),
        repoRoot,
        issueNumber: ISSUE,
        candidateBranch: 'candidate/42-native-gate-route',
        runDirectory,
        runId: RUN_ID
      },
      routeDeps
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);
    expect(run.fixerInvocations).toHaveLength(1);

    // The gate loads the ACTUAL persisted route run and is the sole authority
    // that transitions verifying -> pr-ready. Verdict labels are faked; state and
    // gate-record use the real store round-trip.
    let verdictLabel: VerdictStatus | null = null;
    const gateDeps: GateCommandDeps = {
      resolveRepoRoot: async () => repoRoot,
      resolveRepoRef: async () => repo,
      resolveIssueNumber: async () => ISSUE,
      readState: store.readState,
      writeState: store.writeState,
      readVerdict: async () => verdictLabel,
      writeVerdict: async (_r, _n, _from, to) => {
        verdictLabel = to;
      },
      loadLatestRun,
      writeGateVerdictRecord,
      env: { ISSUEFLOW_ENGINE: '1' },
      write: () => {},
      setExitCode: () => {},
      now: () => new Date('2026-07-03T11:30:00.000Z')
    };

    await gateEvaluateAction({ issue: ISSUE }, gateDeps);

    // State advanced through the gate to pr-ready.
    expect(store.get()).toBe('pr-ready');
    expect(verdictLabel).toBe('pass');

    // The gate recorded the ROUTE run id, so the stale-verdict guard is satisfied.
    const record = await readGateVerdictRecord(repoRoot, ISSUE);
    expect(record?.outcome).toBe('pass');
    expect(record?.runId).toBe(run.runId);

    // Final proof the whole path is consistent: pr create's gate would allow the PR.
    const latest = await loadLatestRun(repoRoot, ISSUE);
    const prGate = assertPrGate({
      state: store.get(),
      verdict: verdictLabel,
      latestRun: latest,
      storedRunId: record?.runId ?? null
    });
    expect(prGate.ok).toBe(true);
  });

  it('drives implementing -> verifying -> implementing when the route stays failing, and pr create is refused', async () => {
    const repoRoot = await makeGitRepo();
    const store = makeStateStore('implementing');

    await store.writeState(repo, ISSUE, 'implementing', 'reviewing');
    await store.writeState(repo, ISSUE, 'reviewing', 'verifying');
    expect(store.get()).toBe('verifying');

    // The shell check never passes. The fake fixer always "succeeds", so the
    // route keeps rerunning the whole route until maxAttempts is exhausted and
    // then stays failed. This is the mirror of the pass path: it proves attempt
    // counting, the fixer seam on the failing side, and the fail verdict path.
    const routeDeps: GateRouteDeps = {
      execCheck: async () => ({ exitCode: 1, signal: null }),
      runAgentReview: async () => ({ status: 'pass', artifactPath: null, findings: null }),
      runFixer: async () => ({ status: 'pass', detail: 'attempted a fix', log: '' }),
      writeRun: async (run) => {
        const { writeRun } = await import('../../src/verification/store.js');
        await writeRun(run);
      },
      now: makeMonotonicNow()
    };

    const runDirectory = await getRunDirectory(repoRoot, ISSUE, RUN_ID);
    const run = await runGateRoute(
      {
        config: makeConfig(),
        routeConfigPath: path.join(repoRoot, 'issueflow.config.json'),
        repoRoot,
        issueNumber: ISSUE,
        candidateBranch: 'candidate/42-native-gate-route',
        runDirectory,
        runId: RUN_ID
      },
      routeDeps
    );

    // maxAttempts is 2: attempt 1 fails -> fixer runs -> attempt 2 fails -> no
    // attempts remain -> route fails. Both attempts were used; the fixer ran once.
    expect(run.status).toBe('fail');
    expect(run.attemptsUsed).toBe(2);
    expect(run.fixerInvocations).toHaveLength(1);

    // The gate loads the persisted failing run and, as the sole authority,
    // transitions verifying -> implementing while recording a fail verdict.
    let verdictLabel: VerdictStatus | null = null;
    const gateDeps: GateCommandDeps = {
      resolveRepoRoot: async () => repoRoot,
      resolveRepoRef: async () => repo,
      resolveIssueNumber: async () => ISSUE,
      readState: store.readState,
      writeState: store.writeState,
      readVerdict: async () => verdictLabel,
      writeVerdict: async (_r, _n, _from, to) => {
        verdictLabel = to;
      },
      loadLatestRun,
      writeGateVerdictRecord,
      env: { ISSUEFLOW_ENGINE: '1' },
      write: () => {},
      setExitCode: () => {},
      now: () => new Date('2026-07-03T11:30:00.000Z')
    };

    await gateEvaluateAction({ issue: ISSUE }, gateDeps);

    // The gate bounced the issue back to implementing and recorded a fail verdict.
    expect(store.get()).toBe('implementing');
    expect(verdictLabel).toBe('fail');

    const record = await readGateVerdictRecord(repoRoot, ISSUE);
    expect(record?.outcome).toBe('fail');
    expect(record?.runId).toBe(run.runId);

    // pr create must refuse: the issue is back in implementing, the verdict is
    // fail, and the latest run did not pass. The gate is the only PR authority.
    const latest = await loadLatestRun(repoRoot, ISSUE);
    const prGate = assertPrGate({
      state: store.get(),
      verdict: verdictLabel,
      latestRun: latest,
      storedRunId: record?.runId ?? null
    });
    expect(prGate.ok).toBe(false);
  });
});
