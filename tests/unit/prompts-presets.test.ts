import { describe, expect, it } from 'vitest';

import { getPromptPreset } from '../../src/prompts/presets.js';

describe('getPromptPreset', () => {
  it('returns a builder for a known preset', () => {
    const builder = getPromptPreset('thermonuclear-review');
    expect(typeof builder).toBe('function');
  });

  it('throws a clear error on an unknown preset', () => {
    expect(() => getPromptPreset('does-not-exist')).toThrowError(
      /unknown prompt preset: does-not-exist/i
    );
  });

  describe('thermonuclear-review builder', () => {
    it('embeds the candidate context and demands a strict JSON verdict', () => {
      const builder = getPromptPreset('thermonuclear-review');
      const prompt = builder({
        issueNumber: 42,
        candidateBranch: 'feat/thing',
        diff: 'diff --git a/x b/x\n+broken',
        issueBody: 'Fix the thing.',
        adrs: '## ADR 1',
        knowledge: '## KB entry',
        priorLogs: 'attempt-1-build.log: OK'
      });

      // Context is threaded into the prompt.
      expect(prompt).toContain('42');
      expect(prompt).toContain('feat/thing');
      expect(prompt).toContain('+broken');
      expect(prompt).toContain('Fix the thing.');
      expect(prompt).toContain('## ADR 1');
      expect(prompt).toContain('## KB entry');
      expect(prompt).toContain('attempt-1-build.log: OK');

      // Strict JSON verdict contract is spelled out.
      expect(prompt).toMatch(/"verdict"/);
      expect(prompt).toMatch(/pass/);
      expect(prompt).toMatch(/fail/);
      expect(prompt).toMatch(/findings/);
      expect(prompt).toMatch(/blocking/i);
    });

    it('tolerates absent optional context without emitting "undefined"', () => {
      const builder = getPromptPreset('thermonuclear-review');
      const prompt = builder({
        issueNumber: 7,
        candidateBranch: null,
        diff: '',
        issueBody: null,
        adrs: '',
        knowledge: '',
        priorLogs: ''
      });

      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('null');
      expect(prompt).toMatch(/"verdict"/);
    });
  });

  describe('gate-fixer builder', () => {
    it('is a known preset', () => {
      const builder = getPromptPreset('gate-fixer');
      expect(typeof builder).toBe('function');
    });

    it('embeds failed check names, commands + exit codes, log summaries, and review findings', () => {
      const builder = getPromptPreset('gate-fixer');
      const prompt = builder({
        issueNumber: 42,
        candidateBranch: 'feat/thing',
        diff: 'diff --git a/x b/x\n+broken',
        issueBody: 'Fix the thing.',
        failedChecks: [
          {
            name: 'build',
            kind: 'shell',
            command: 'npm run build',
            exitCode: 2,
            logPath: '/runs/attempt-1-build.log',
            logSummary: 'TS2345: bad type at x.ts',
            reviewFindings: null
          },
          {
            name: 'review',
            kind: 'agent-review',
            command: null,
            exitCode: null,
            logPath: '/runs/attempt-1-review.log',
            logSummary: '',
            reviewFindings: '- blocker: off-by-one in loop'
          }
        ]
      });

      // Failed check names.
      expect(prompt).toContain('build');
      expect(prompt).toContain('review');
      // Command + exit code of the shell check.
      expect(prompt).toContain('npm run build');
      expect(prompt).toContain('2');
      // Log path + summary.
      expect(prompt).toContain('/runs/attempt-1-build.log');
      expect(prompt).toContain('TS2345: bad type at x.ts');
      // Review findings when the failed check was an agent-review.
      expect(prompt).toContain('off-by-one in loop');
      // Issue/spec + diff context.
      expect(prompt).toContain('42');
      expect(prompt).toContain('feat/thing');
      expect(prompt).toContain('Fix the thing.');
      expect(prompt).toContain('+broken');
    });

    it('forbids editing the route config and unrelated code, and forbids declaring the route fixed', () => {
      const builder = getPromptPreset('gate-fixer');
      const prompt = builder({
        issueNumber: 1,
        candidateBranch: 'b',
        diff: 'd',
        issueBody: null,
        failedChecks: [
          {
            name: 'test',
            kind: 'shell',
            command: 'npm test',
            exitCode: 1,
            logPath: '/runs/attempt-1-test.log',
            logSummary: 'AssertionError',
            reviewFindings: null
          }
        ]
      });

      // Do-not-edit-config instruction (mentions the config file and gateRoute).
      expect(prompt).toContain('issueflow.config.json');
      expect(prompt).toContain('gateRoute');
      expect(prompt).toMatch(/do not/i);
      // Minimal-change instruction.
      expect(prompt).toMatch(/minimal/i);
      expect(prompt).toMatch(/unrelated/i);
      // Must not claim to have fixed the route; the rerun decides.
      expect(prompt).toMatch(/rerun|route decides|do not declare|not declare/i);
    });

    it('tolerates absent optional context without emitting "undefined" or "null"', () => {
      const builder = getPromptPreset('gate-fixer');
      const prompt = builder({
        issueNumber: 7,
        candidateBranch: null,
        diff: '',
        issueBody: null,
        failedChecks: [
          {
            name: 'test',
            kind: 'shell',
            command: null,
            exitCode: null,
            logPath: '/runs/attempt-1-test.log',
            logSummary: '',
            reviewFindings: null
          }
        ]
      });

      expect(prompt).not.toContain('undefined');
      // The word "null" must not leak into rendered context blocks.
      expect(prompt).not.toMatch(/\bnull\b/);
    });
  });
});
