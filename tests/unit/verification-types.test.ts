import { describe, expect, it } from 'vitest';

import { verificationConfigSchema } from '../../src/verification/types.js';

describe('verificationConfigSchema', () => {
  it('accepts a full config with defaults filled in', () => {
    const parsed = verificationConfigSchema.parse({
      verification: {
        checks: [
          { name: 'lint', command: 'npm', args: ['run', 'lint'] },
          { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] }
        ]
      }
    });

    expect(parsed.verification.checks).toHaveLength(2);
    expect(parsed.verification.checks[0]).toEqual({
      name: 'lint',
      command: 'npm',
      args: ['run', 'lint'],
      env: {}
    });
  });

  it('defaults args and env when omitted', () => {
    const parsed = verificationConfigSchema.parse({
      verification: {
        checks: [{ name: 'lint', command: 'eslint' }]
      }
    });

    expect(parsed.verification.checks[0].args).toEqual([]);
    expect(parsed.verification.checks[0].env).toEqual({});
  });

  it('rejects missing checks array', () => {
    expect(() => verificationConfigSchema.parse({ verification: {} })).toThrow();
  });

  it('rejects empty checks array', () => {
    expect(() => verificationConfigSchema.parse({ verification: { checks: [] } })).toThrow(/at least one check/i);
  });

  it('rejects duplicate names', () => {
    expect(() =>
      verificationConfigSchema.parse({
        verification: {
          checks: [
            { name: 'lint', command: 'eslint' },
            { name: 'lint', command: 'eslint', args: ['.'] }
          ]
        }
      })
    ).toThrow(/unique/i);
  });

  it('rejects names that violate the regex', () => {
    expect(() =>
      verificationConfigSchema.parse({
        verification: {
          checks: [{ name: 'Lint Things', command: 'eslint' }]
        }
      })
    ).toThrow();
  });
});
