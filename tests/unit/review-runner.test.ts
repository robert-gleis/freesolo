import { describe, expect, it } from 'vitest';

import { CodexAgentAdapter, type CodexInvoker } from '../../src/agents/codex.js';
import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import { runReviewAgent } from '../../src/agents/review-runner.js';

const PASS_JSON = JSON.stringify({ verdict: 'pass', findings: [] });
const FAIL_JSON = JSON.stringify({
  verdict: 'fail',
  findings: [{ severity: 'high', file: 'a.ts', line: 3, message: 'boom' }]
});

describe('runReviewAgent', () => {
  it('returns a pass verdict from valid JSON', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: PASS_JSON }]
    });

    const result = await runReviewAgent({ adapter, prompt: 'review this', cwd: '/tmp' });

    expect(result.verdict).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  it('returns a fail verdict with findings from valid JSON', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: FAIL_JSON }]
    });

    const result = await runReviewAgent({ adapter, prompt: 'review this', cwd: '/tmp' });

    expect(result.verdict).toBe('fail');
    expect(result.findings).toEqual([
      { severity: 'high', file: 'a.ts', line: 3, message: 'boom' }
    ]);
  });

  it('accepts a fenced JSON verdict', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: '```json\n' + PASS_JSON + '\n```' }]
    });

    const result = await runReviewAgent({ adapter, prompt: 'review', cwd: '/tmp' });

    expect(result.verdict).toBe('pass');
  });

  it('retries once with a corrective prompt when the first output is unparseable', async () => {
    let sends = 0;
    const adapter = new ScriptedAgentAdapter({
      steps: [
        { match: /^review/, output: 'sorry, no JSON here' },
        // The retry prompt is a corrective follow-up; match anything that is not
        // the original prompt so this only fires on the second send.
        { match: /JSON/i, output: FAIL_JSON }
      ]
    });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      sends += 1;
      return original(input);
    };

    const result = await runReviewAgent({ adapter, prompt: 'review this', cwd: '/tmp' });

    expect(sends).toBe(2);
    expect(result.verdict).toBe('fail');
  });

  it('returns fail when JSON never parses after the retry', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'never valid json' }]
    });

    const result = await runReviewAgent({ adapter, prompt: 'review', cwd: '/tmp' });

    expect(result.verdict).toBe('fail');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].message).toMatch(/could not|parse|json/i);
  });

  it('returns fail when the JSON parses but fails the verdict schema after retry', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify({ verdict: 'maybe' }) }]
    });

    const result = await runReviewAgent({ adapter, prompt: 'review', cwd: '/tmp' });

    expect(result.verdict).toBe('fail');
  });

  it('returns fail when the timeout elapses before the agent responds', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    // Never resolve — force the timeout path.
    adapter.send = () => new Promise(() => {});

    const result = await runReviewAgent({
      adapter,
      prompt: 'review',
      cwd: '/tmp',
      timeoutSeconds: 0.01
    });

    expect(result.verdict).toBe('fail');
    expect(result.findings[0].message).toMatch(/timed out|timeout|abort/i);
  });

  it('returns fail when an external abort signal fires', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    adapter.send = () => new Promise(() => {});
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runReviewAgent({
      adapter,
      prompt: 'review',
      cwd: '/tmp',
      abortSignal: controller.signal
    });

    expect(result.verdict).toBe('fail');
    expect(result.findings[0].message).toMatch(/abort|cancel/i);
  });

  it('starts an idle adapter and stops it on success', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: PASS_JSON }]
    });
    expect((await adapter.status()).state).toBe('idle');

    await runReviewAgent({ adapter, prompt: 'review', cwd: '/tmp' });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('cancels the spawned subprocess when the timeout fires (signal reaches the invoker)', async () => {
    // A real adapter with a fake invoker that never resolves until its signal
    // aborts. Proves the review timeout terminates the child rather than leaking
    // a process that keeps running after the check recorded fail.
    let seenSignal: AbortSignal | undefined;
    const invoker: CodexInvoker = ({ signal }) =>
      new Promise((_resolve, reject) => {
        seenSignal = signal;
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    const adapter = new CodexAgentAdapter({ invoker });

    const result = await runReviewAgent({
      adapter,
      prompt: 'review',
      cwd: process.cwd(),
      timeoutSeconds: 0.01
    });

    expect(result.verdict).toBe('fail');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(true);
  });

  it('cancels the spawned subprocess when an external abort fires', async () => {
    let seenSignal: AbortSignal | undefined;
    const invoker: CodexInvoker = ({ signal }) =>
      new Promise((_resolve, reject) => {
        seenSignal = signal;
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    const adapter = new CodexAgentAdapter({ invoker });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runReviewAgent({
      adapter,
      prompt: 'review',
      cwd: process.cwd(),
      abortSignal: controller.signal
    });

    expect(result.verdict).toBe('fail');
    expect(seenSignal!.aborted).toBe(true);
  });

  it('stops an owned adapter even after a timeout', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    adapter.send = () => new Promise(() => {});

    await runReviewAgent({
      adapter,
      prompt: 'review',
      cwd: '/tmp',
      timeoutSeconds: 0.01
    });

    expect((await adapter.status()).state).toBe('stopped');
  });
});
