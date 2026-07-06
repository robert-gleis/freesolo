import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import type { AgentAdapter } from '../../src/agents/types.js';
import {
  runAgentReviewCheck,
  type AgentReviewDeps
} from '../../src/verification/agent-review-check.js';
import { DIFF_MAX_CHARS } from '../../src/verification/context-deps.js';
import type { AgentReviewRequest } from '../../src/verification/route-runner.js';

const tempDirs: string[] = [];

async function makeRunDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-agent-review-'));
  tempDirs.push(dir);
  return dir;
}

const PASS_JSON = JSON.stringify({ verdict: 'pass', findings: [] });
const FAIL_JSON = JSON.stringify({
  verdict: 'fail',
  findings: [{ severity: 'high', file: 'a.ts', line: 3, message: 'boom' }]
});

function makeRequest(runDirectory: string, overrides: Partial<AgentReviewRequest> = {}): AgentReviewRequest {
  return {
    check: {
      name: 'review',
      kind: 'agent-review',
      host: 'codex',
      promptPreset: 'thermonuclear-review'
    },
    repoRoot: '/repo',
    issueNumber: 7,
    candidateBranch: 'candidate/7',
    baseBranch: 'main',
    attempt: 1,
    runDirectory,
    logPath: path.join(runDirectory, 'attempt-1-review.log'),
    ...overrides
  };
}

function makeDeps(adapter: AgentAdapter, overrides: Partial<AgentReviewDeps> = {}): AgentReviewDeps {
  return {
    getAgentAdapter: () => adapter,
    getBranchDiff: async () => 'diff --git a/x b/x',
    getIssueBody: async () => 'issue body',
    listAdrs: async () => [],
    loadKnowledgeEntries: async () => [],
    runReviewAgent: (input) => import('../../src/agents/review-runner.js').then((m) => m.runReviewAgent(input)),
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runAgentReviewCheck', () => {
  it('passes when the scripted agent returns a pass verdict and writes the artifact', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    const result = await runAgentReviewCheck(makeRequest(runDirectory), makeDeps(adapter));

    expect(result.status).toBe('pass');
    expect(result.findings).toBeNull();
    const artifactPath = path.join(runDirectory, 'attempt-1-review-review.json');
    expect(result.artifactPath).toBe(artifactPath);
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    expect(artifact.verdict).toBe('pass');
    expect(artifact.findings).toEqual([]);
  });

  it('caps an oversized branch diff before it enters the prompt', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    let capturedPrompt = '';
    const deps = makeDeps(adapter, {
      getBranchDiff: async () => 'x'.repeat(DIFF_MAX_CHARS + 1024),
      runReviewAgent: async (input) => {
        capturedPrompt = input.prompt;
        return { verdict: 'pass', findings: [] };
      }
    });

    const result = await runAgentReviewCheck(makeRequest(runDirectory), deps);

    expect(result.status).toBe('pass');
    expect(capturedPrompt).toContain('[diff truncated: showing first');
    expect(capturedPrompt.length).toBeLessThan(DIFF_MAX_CHARS + 8 * 1024);
  });

  it('scopes the artifact filename by attempt so a later attempt cannot clobber an earlier one', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    const first = await runAgentReviewCheck(
      makeRequest(runDirectory, { attempt: 1 }),
      makeDeps(adapter)
    );
    const second = await runAgentReviewCheck(
      makeRequest(runDirectory, { attempt: 2 }),
      makeDeps(adapter)
    );

    expect(first.artifactPath).toBe(path.join(runDirectory, 'attempt-1-review-review.json'));
    expect(second.artifactPath).toBe(path.join(runDirectory, 'attempt-2-review-review.json'));
    expect(first.artifactPath).not.toBe(second.artifactPath);
    // both survive on disk
    await fs.access(first.artifactPath as string);
    await fs.access(second.artifactPath as string);
  });

  it('fails with findings when the scripted agent returns a fail verdict', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: FAIL_JSON }] });

    const result = await runAgentReviewCheck(makeRequest(runDirectory), makeDeps(adapter));

    expect(result.status).toBe('fail');
    expect(result.findings).toContain('boom');
    expect(result.artifactPath).toBe(path.join(runDirectory, 'attempt-1-review-review.json'));
    const artifact = JSON.parse(await fs.readFile(result.artifactPath as string, 'utf8'));
    expect(artifact.verdict).toBe('fail');
    expect(artifact.findings[0].message).toBe('boom');
  });

  it('fails (never silently passes) when the agent output is unparseable', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ fallback: 'not json at all', steps: [] });

    const result = await runAgentReviewCheck(makeRequest(runDirectory), makeDeps(adapter));

    expect(result.status).toBe('fail');
    // artifact still written so the failure has evidence
    const artifact = JSON.parse(await fs.readFile(result.artifactPath as string, 'utf8'));
    expect(artifact.verdict).toBe('fail');
  });

  it('fails when the review agent times out', async () => {
    const runDirectory = await makeRunDir();
    // An adapter whose send never resolves; the timeout signal must fail the check.
    const hangingAdapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {},
      send: () => new Promise(() => {}),
      status: async () => ({ state: 'idle' })
    };

    const result = await runAgentReviewCheck(
      makeRequest(runDirectory, {
        check: {
          name: 'review',
          kind: 'agent-review',
          host: 'codex',
          promptPreset: 'thermonuclear-review',
          timeoutSeconds: 0.05
        }
      }),
      makeDeps(hangingAdapter)
    );

    expect(result.status).toBe('fail');
    expect(result.findings ?? '').toMatch(/timed out|abort/i);
  });

  it('assembles the review context: diff, issue body, ADRs, knowledge, prior logs', async () => {
    const runDirectory = await makeRunDir();
    // A prior log for THIS attempt (attempt 1) that must be threaded into the prompt.
    await fs.writeFile(
      path.join(runDirectory, 'attempt-1-build.log'),
      '[stderr] compile error XYZ\n'
    );
    // A log from a DIFFERENT attempt that must be ignored.
    await fs.writeFile(path.join(runDirectory, 'attempt-2-build.log'), 'unrelated attempt\n');

    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({
      steps: [
        {
          match: /.*/,
          output: PASS_JSON
        }
      ]
    });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runAgentReviewCheck(
      makeRequest(runDirectory),
      makeDeps(adapter, {
        getBranchDiff: async () => 'DIFF-MARKER',
        getIssueBody: async () => 'ISSUEBODY-MARKER',
        listAdrs: async () => [
          {
            number: 1,
            slug: 'foo',
            filename: '0001-foo.md',
            relativePath: 'docs/adr/0001-foo.md',
            content: 'ADR-MARKER'
          }
        ],
        loadKnowledgeEntries: async () => [
          { filename: 'k.md', title: 'K', content: 'KNOWLEDGE-MARKER' }
        ]
      })
    );

    expect(capturedPrompt).toContain('DIFF-MARKER');
    expect(capturedPrompt).toContain('ISSUEBODY-MARKER');
    expect(capturedPrompt).toContain('ADR-MARKER');
    expect(capturedPrompt).toContain('KNOWLEDGE-MARKER');
    expect(capturedPrompt).toContain('compile error XYZ');
    expect(capturedPrompt).not.toContain('unrelated attempt');
  });

  it('caps each prior log so a runaway earlier check cannot blow up the review prompt', async () => {
    const runDirectory = await makeRunDir();
    // A prior check for THIS attempt wrote a runaway multi-MB log. It must be
    // tailed/capped before entering the prompt, not read in full.
    const runaway = `${'RUNAWAY '.repeat(2 * 1024 * 1024)}\nFINAL-TAIL-LINE\n`;
    await fs.writeFile(path.join(runDirectory, 'attempt-1-build.log'), runaway);

    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runAgentReviewCheck(makeRequest(runDirectory), makeDeps(adapter));

    // The whole runaway log must NOT be in the prompt; the prompt stays bounded.
    expect(capturedPrompt.length).toBeLessThan(runaway.length);
    // The prompt is on the order of the tail cap, not megabytes.
    expect(capturedPrompt.length).toBeLessThan(100 * 1024);
    // The recent tail of the log is preserved (the useful part for the reviewer).
    expect(capturedPrompt).toContain('FINAL-TAIL-LINE');
  });

  it('caps the total assembled prior logs across many prior checks', async () => {
    const runDirectory = await makeRunDir();
    // Several prior checks, each with a sizeable log. The assembled priorLogs
    // block must stay bounded even in aggregate.
    for (let i = 0; i < 20; i += 1) {
      await fs.writeFile(
        path.join(runDirectory, `attempt-1-check${i}.log`),
        `${'z'.repeat(500 * 1024)}\nTAIL-${i}\n`
      );
    }

    let capturedPrompt = '';
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      return original(input);
    };

    await runAgentReviewCheck(makeRequest(runDirectory), makeDeps(adapter));

    // Total prompt must not balloon to the raw ~10 MB of concatenated logs.
    expect(capturedPrompt.length).toBeLessThan(1 * 1024 * 1024);
  });

  it('diffs the candidate against the recorded base branch (not a hardcoded main)', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });
    const seen: Array<{ repoRoot: string; base: string | null }> = [];

    await runAgentReviewCheck(
      makeRequest(runDirectory, { repoRoot: '/repo', baseBranch: 'develop' }),
      makeDeps(adapter, {
        getBranchDiff: async (repoRoot, base) => {
          seen.push({ repoRoot, base });
          return 'diff';
        }
      })
    );

    expect(seen).toEqual([{ repoRoot: '/repo', base: 'develop' }]);
  });

  it('resolves the adapter for the check host (host-agnostic)', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });
    const seenHosts: string[] = [];

    await runAgentReviewCheck(
      makeRequest(runDirectory, {
        check: { name: 'review', kind: 'agent-review', host: 'cursor', promptPreset: 'thermonuclear-review' }
      }),
      makeDeps(adapter, {
        getAgentAdapter: (host) => {
          seenHosts.push(host);
          return adapter;
        }
      })
    );

    expect(seenHosts).toEqual(['cursor']);
  });

  it('fails (never throws) when context assembly errors, e.g. the diff cannot be read', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    const result = await runAgentReviewCheck(
      makeRequest(runDirectory),
      makeDeps(adapter, {
        getBranchDiff: async () => {
          throw new Error('git exploded');
        }
      })
    );

    expect(result.status).toBe('fail');
    expect(result.findings ?? '').toContain('git exploded');
    // evidence artifact is still written for the failed assembly
    const artifact = JSON.parse(await fs.readFile(result.artifactPath as string, 'utf8'));
    expect(artifact.verdict).toBe('fail');
  });

  it('fails (never throws) when the prompt preset is unknown', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    const result = await runAgentReviewCheck(
      makeRequest(runDirectory, {
        check: {
          name: 'review',
          kind: 'agent-review',
          host: 'codex',
          promptPreset: 'does-not-exist'
        }
      }),
      makeDeps(adapter)
    );

    expect(result.status).toBe('fail');
    expect(result.findings ?? '').toMatch(/unknown prompt preset/i);
  });

  it('tolerates an unreadable issue body (null) without failing the assembly', async () => {
    const runDirectory = await makeRunDir();
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: PASS_JSON }] });

    const result = await runAgentReviewCheck(
      makeRequest(runDirectory),
      makeDeps(adapter, { getIssueBody: async () => null })
    );

    expect(result.status).toBe('pass');
  });
});
