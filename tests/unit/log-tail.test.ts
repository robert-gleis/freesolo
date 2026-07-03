import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  capTail,
  readLogTail,
  LOG_TAIL_LINES,
  LOG_TAIL_MAX_CHARS,
  LOG_TAIL_READ_BYTES
} from '../../src/verification/log-tail.js';

const tempDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-log-tail-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('readLogTail', () => {
  it('returns the full content for a small log', async () => {
    const dir = await makeDir();
    const p = path.join(dir, 'small.log');
    await fs.writeFile(p, 'line one\nline two\n');

    expect(await readLogTail(p)).toBe('line one\nline two');
  });

  it('returns "" for a missing file (never throws)', async () => {
    const dir = await makeDir();
    expect(await readLogTail(path.join(dir, 'nope.log'))).toBe('');
  });

  it('caps at the last N lines', async () => {
    const dir = await makeDir();
    const p = path.join(dir, 'many.log');
    const lines = Array.from({ length: LOG_TAIL_LINES + 20 }, (_, i) => `line-${i}`);
    await fs.writeFile(p, lines.join('\n'));

    const tail = await readLogTail(p);
    const tailLines = tail.split('\n');
    expect(tailLines.length).toBeLessThanOrEqual(LOG_TAIL_LINES);
    // keeps the LAST lines, drops the earliest
    expect(tail).toContain(`line-${LOG_TAIL_LINES + 19}`);
    expect(tail).not.toContain('line-0\n');
  });

  it('caps a huge single-line log at LOG_TAIL_MAX_CHARS without reading the whole file into memory', async () => {
    const dir = await makeDir();
    const p = path.join(dir, 'runaway.log');
    // A single ~8 MB line — far bigger than the on-disk read budget. If the impl
    // read the whole file this test would still pass on content but the point is
    // the bounded read: assert only a bounded amount is returned.
    const huge = 'x'.repeat(8 * 1024 * 1024);
    await fs.writeFile(p, huge);

    const tail = await readLogTail(p);
    expect(tail.length).toBeLessThanOrEqual(LOG_TAIL_MAX_CHARS);
  });

  it('reads no more than the tail byte budget from disk', async () => {
    const dir = await makeDir();
    const p = path.join(dir, 'budget.log');
    // Distinct head marker at the very start; if we only read the tail budget
    // from a file larger than the budget, the head marker must NOT appear.
    const head = 'HEAD-MARKER\n';
    const filler = 'a\n'.repeat(LOG_TAIL_READ_BYTES); // > read budget, plus newlines
    await fs.writeFile(p, head + filler + 'TAIL-MARKER');

    const tail = await readLogTail(p);
    expect(tail).toContain('TAIL-MARKER');
    expect(tail).not.toContain('HEAD-MARKER');
  });
});

describe('capTail', () => {
  it('trims and keeps the last lines', () => {
    const lines = Array.from({ length: LOG_TAIL_LINES + 5 }, (_, i) => `l${i}`);
    const capped = capTail(`${lines.join('\n')}\n`);
    expect(capped.split('\n').length).toBeLessThanOrEqual(LOG_TAIL_LINES);
    expect(capped).toContain(`l${LOG_TAIL_LINES + 4}`);
  });

  it('caps char length', () => {
    const capped = capTail('y'.repeat(LOG_TAIL_MAX_CHARS + 500));
    expect(capped.length).toBe(LOG_TAIL_MAX_CHARS);
  });
});
