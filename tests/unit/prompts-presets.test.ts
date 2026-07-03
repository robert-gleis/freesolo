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
});
