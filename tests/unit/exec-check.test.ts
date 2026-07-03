import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultExecCheck, runShellCheck } from '../../src/verification/runner.js';

const tempDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-exec-check-'));
  tempDirs.push(dir);
  return dir;
}

/** A Node child that installs SIGINT/SIGTERM handlers and refuses to exit. */
const IGNORE_SIGNALS_SCRIPT =
  "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});" +
  'setInterval(()=>{},1000);setTimeout(()=>process.exit(0),60000);';

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('defaultExecCheck termination bound', () => {
  it('force-kills a child that ignores the graceful signal so the await is bounded', async () => {
    const prev = process.env.ISSUEFLOW_FORCE_KILL_MS;
    // Escalate to SIGKILL quickly so this test stays fast.
    process.env.ISSUEFLOW_FORCE_KILL_MS = '300';
    try {
      const controller = new AbortController();
      const start = Date.now();
      setTimeout(() => controller.abort(), 100);

      const result = await defaultExecCheck(
        { command: process.execPath, args: ['-e', IGNORE_SIGNALS_SCRIPT], cwd: process.cwd(), env: {} },
        () => {},
        controller.signal
      );

      const elapsed = Date.now() - start;
      // Without a SIGKILL backstop this would hang ~60s (the child's own timeout).
      // With the backstop it must resolve shortly after abort + forceKill delay.
      expect(elapsed).toBeLessThan(10_000);
      // A killed child never exits zero.
      expect(result.exitCode).not.toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.ISSUEFLOW_FORCE_KILL_MS;
      } else {
        process.env.ISSUEFLOW_FORCE_KILL_MS = prev;
      }
    }
  }, 20_000);

  it('a timed-out ignoring child surfaces as a failed shell check', async () => {
    const dir = await makeDir();
    const prev = process.env.ISSUEFLOW_FORCE_KILL_MS;
    process.env.ISSUEFLOW_FORCE_KILL_MS = '300';
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const logPath = path.join(dir, 'check.log');

      const outcome = await runShellCheck(
        { command: process.execPath, args: ['-e', IGNORE_SIGNALS_SCRIPT], cwd: process.cwd(), env: {} },
        logPath,
        defaultExecCheck,
        controller.signal
      );

      expect(outcome.status).toBe('fail');
    } finally {
      if (prev === undefined) {
        delete process.env.ISSUEFLOW_FORCE_KILL_MS;
      } else {
        process.env.ISSUEFLOW_FORCE_KILL_MS = prev;
      }
    }
  }, 20_000);

  it('runs a normal command to completion and reports its exit code', async () => {
    const result = await defaultExecCheck(
      { command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), env: {} },
      () => {},
      undefined
    );
    expect(result.exitCode).toBe(0);
  });
});
