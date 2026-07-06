import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import type { AgentAdapter } from '../../src/agents/types.js';
import { DIFF_MAX_CHARS } from '../../src/verification/context-deps.js';
import { runFixerCheck, type FixerCheckDeps } from '../../src/verification/fixer-check.js';
import type { FailureContext } from '../../src/verification/route-runner.js';

const tempDirs: string[] = [];

async function makeRunDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-fixer-check-'));
  tempDirs.push(dir);
  return dir;
}

function makeContext(runDirectory: string, overrides: Partial<FailureContext> = {}): FailureContext {
  return {
    attempt: 1,
    repoRoot: '/repo',
    issueNumber: 7,
    candidateBranch: 'candidate/7',
    baseBranch: 'main',
    fixer: { host: 'codex', promptPreset: 'gate-fixer' },
    failedChecks: [
      {
        name: 'build',
        kind: 'shell',
        command: 'npm run build',
        exitCode: 2,
        logPath: path.join(runDirectory, 'attempt-1-build.log'),
        reviewFindings: null
      }
    ],
    logPath: path.join(runDirectory, 'fixer-attempt-1.log'),
    runDirectory,
    ...overrides
  };
}

function makeDeps(adapter: AgentAdapter, overrides: Partial<FixerCheckDeps> = {}): FixerCheckDeps {
  return {
    getAgentAdapter: () => adapter,
    getBranchDiff: async () => 'diff --git a/x b/x',
    getIssueBody: async () => 'issue body',
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runFixerCheck (default runFixer)', () => {
  it('passes when the scripted fixer agent completes and writes the fixer log', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'applied the fix' }] });

    const result = await runFixerCheck(makeContext(runDirectory), makeDeps(adapter));

    expect(result.status).toBe('pass');
    const logPath = path.join(runDirectory, 'fixer-attempt-1.log');
    const log = await fs.readFile(logPath, 'utf8');
    expect(log).toContain('applied the fix');
  });

  it('assembles the fixer prompt with the failing check log summary, diff, and issue body', async () => {
    const runDirectory = await makeRunDir();
    // The failing check's per-check log must be summarized into the prompt.
    await fs.writeFile(
      path.join(runDirectory, 'attempt-1-build.log'),
      '[stderr] TS2345: argument not assignable\n'
    );

    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runFixerCheck(
      makeContext(runDirectory),
      makeDeps(adapter, {
        getBranchDiff: async () => 'DIFF-MARKER',
        getIssueBody: async () => 'ISSUEBODY-MARKER'
      })
    );

    expect(capturedPrompt).toContain('DIFF-MARKER');
    expect(capturedPrompt).toContain('ISSUEBODY-MARKER');
    expect(capturedPrompt).toContain('TS2345: argument not assignable');
    // Failed check identity is present.
    expect(capturedPrompt).toContain('build');
    expect(capturedPrompt).toContain('npm run build');
  });

  it('caps an oversized diff before it enters the prompt', async () => {
    const runDirectory = await makeRunDir();

    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runFixerCheck(
      makeContext(runDirectory),
      makeDeps(adapter, {
        getBranchDiff: async () => 'x'.repeat(DIFF_MAX_CHARS + 1024)
      })
    );

    expect(capturedPrompt).toContain('[diff truncated: showing first');
    expect(capturedPrompt.length).toBeLessThan(DIFF_MAX_CHARS + 8 * 1024);
  });

  it('threads review findings into the prompt when the failed check was an agent-review', async () => {
    const runDirectory = await makeRunDir();
    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runFixerCheck(
      makeContext(runDirectory, {
        failedChecks: [
          {
            name: 'review',
            kind: 'agent-review',
            command: null,
            exitCode: null,
            logPath: path.join(runDirectory, 'attempt-1-review.log'),
            reviewFindings: '- blocker: off-by-one in loop'
          }
        ]
      }),
      makeDeps(adapter)
    );

    expect(capturedPrompt).toContain('off-by-one in loop');
  });

  it('diffs the candidate against the recorded base branch (not a hardcoded main)', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const seen: Array<{ repoRoot: string; base: string | null }> = [];

    await runFixerCheck(
      makeContext(runDirectory, { repoRoot: '/repo', baseBranch: 'develop' }),
      makeDeps(adapter, {
        getBranchDiff: async (repoRoot, base) => {
          seen.push({ repoRoot, base });
          return 'diff';
        }
      })
    );

    expect(seen).toEqual([{ repoRoot: '/repo', base: 'develop' }]);
  });

  it('resolves the adapter for the fixer host (host-agnostic)', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const seenHosts: string[] = [];

    await runFixerCheck(
      makeContext(runDirectory, { fixer: { host: 'cursor', promptPreset: 'gate-fixer' } }),
      makeDeps(adapter, {
        getAgentAdapter: (host) => {
          seenHosts.push(host);
          return adapter;
        }
      })
    );

    expect(seenHosts).toEqual(['cursor']);
  });

  it('fails (never throws) when the fixer agent times out', async () => {
    const runDirectory = await makeRunDir();
    const hanging: AgentAdapter = {
      start: async () => {},
      stop: async () => {},
      send: () => new Promise(() => {}),
      status: async () => ({ state: 'idle' })
    };

    const result = await runFixerCheck(
      makeContext(runDirectory, {
        fixer: { host: 'codex', promptPreset: 'gate-fixer', timeoutSeconds: 0.05 }
      }),
      makeDeps(hanging)
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/timed out|abort/i);
  });

  it('fails (never throws) when context assembly errors, e.g. the diff cannot be read', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });

    const result = await runFixerCheck(
      makeContext(runDirectory),
      makeDeps(adapter, {
        getBranchDiff: async () => {
          throw new Error('git exploded');
        }
      })
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('git exploded');
  });

  it('fails (never throws) when the prompt preset is unknown', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });

    const result = await runFixerCheck(
      makeContext(runDirectory, {
        fixer: { host: 'codex', promptPreset: 'does-not-exist' }
      }),
      makeDeps(adapter)
    );

    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/unknown prompt preset/i);
  });

  it('tolerates an unreadable issue body (null) without failing', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });

    const result = await runFixerCheck(
      makeContext(runDirectory),
      makeDeps(adapter, { getIssueBody: async () => null })
    );

    expect(result.status).toBe('pass');
  });
});
