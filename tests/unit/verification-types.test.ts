import { describe, expect, it } from 'vitest';

import { HOST_TOOLS } from '../../src/core/types.js';
import { verificationConfigSchema } from '../../src/verification/types.js';

function validGateRoute() {
  return {
    verification: {
      gateRoute: {
        maxAttempts: 3,
        bail: true,
        checks: [
          { name: 'build', kind: 'shell', command: 'npm', args: ['run', 'build'] },
          { name: 'test', kind: 'shell', command: 'npm', args: ['test'], timeoutSeconds: 900 },
          {
            name: 'review',
            kind: 'agent-review',
            host: 'codex',
            promptPreset: 'thermonuclear-review',
            timeoutSeconds: 1800
          }
        ],
        fixer: {
          host: 'codex',
          promptPreset: 'gate-fixer',
          timeoutSeconds: 1800
        }
      }
    }
  };
}

describe('verificationConfigSchema (gateRoute)', () => {
  it('accepts a full valid gateRoute config', () => {
    const parsed = verificationConfigSchema.parse(validGateRoute());

    expect(parsed.verification.gateRoute.maxAttempts).toBe(3);
    expect(parsed.verification.gateRoute.bail).toBe(true);
    expect(parsed.verification.gateRoute.checks).toHaveLength(3);
    expect(parsed.verification.gateRoute.fixer.host).toBe('codex');
  });

  it('fills shell check args and env defaults', () => {
    const parsed = verificationConfigSchema.parse({
      verification: {
        gateRoute: {
          maxAttempts: 1,
          bail: false,
          checks: [{ name: 'lint', kind: 'shell', command: 'eslint' }],
          fixer: { host: 'claude', promptPreset: 'gate-fixer' }
        }
      }
    });

    const check = parsed.verification.gateRoute.checks[0];
    expect(check.kind).toBe('shell');
    if (check.kind === 'shell') {
      expect(check.args).toEqual([]);
      expect(check.env).toEqual({});
    }
  });

  it('discriminates shell and agent-review checks', () => {
    const parsed = verificationConfigSchema.parse(validGateRoute());
    const kinds = parsed.verification.gateRoute.checks.map((check) => check.kind);
    expect(kinds).toEqual(['shell', 'shell', 'agent-review']);
  });

  it('rejects the old verification.checks shape', () => {
    expect(() =>
      verificationConfigSchema.parse({
        verification: {
          checks: [{ name: 'lint', command: 'npm', args: ['run', 'lint'] }]
        }
      })
    ).toThrow();
  });

  it('rejects a config missing gateRoute', () => {
    expect(() => verificationConfigSchema.parse({ verification: {} })).toThrow();
  });

  it('rejects unknown keys under verification (strict)', () => {
    expect(() =>
      verificationConfigSchema.parse({
        verification: {
          gateRoute: validGateRoute().verification.gateRoute,
          checks: [{ name: 'lint', command: 'eslint' }]
        }
      })
    ).toThrow();
  });

  it('rejects maxAttempts below 1', () => {
    const config = validGateRoute();
    config.verification.gateRoute.maxAttempts = 0;
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects a non-integer maxAttempts', () => {
    const config = validGateRoute();
    (config.verification.gateRoute as { maxAttempts: number }).maxAttempts = 2.5;
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects an empty checks array', () => {
    const config = validGateRoute();
    config.verification.gateRoute.checks = [];
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects an unknown host on an agent-review check', () => {
    expect(HOST_TOOLS).not.toContain('pi');
    const config = validGateRoute();
    (config.verification.gateRoute.checks[2] as { host: string }).host = 'pi';
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects an unknown host on the fixer', () => {
    const config = validGateRoute();
    (config.verification.gateRoute.fixer as { host: string }).host = 'nope';
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('requires host and promptPreset on an agent-review check', () => {
    const config = validGateRoute();
    config.verification.gateRoute.checks = [
      { name: 'review', kind: 'agent-review' } as never
    ];
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects an empty promptPreset on an agent-review check', () => {
    const config = validGateRoute();
    config.verification.gateRoute.checks = [
      { name: 'review', kind: 'agent-review', host: 'codex', promptPreset: '' } as never
    ];
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('requires a command on a shell check', () => {
    const config = validGateRoute();
    config.verification.gateRoute.checks = [{ name: 'build', kind: 'shell' } as never];
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects an unknown check kind', () => {
    const config = validGateRoute();
    config.verification.gateRoute.checks = [
      { name: 'weird', kind: 'sorcery', command: 'x' } as never
    ];
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('requires a fixer', () => {
    const config = validGateRoute() as { verification: { gateRoute: Record<string, unknown> } };
    delete config.verification.gateRoute.fixer;
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });

  it('rejects a non-positive timeoutSeconds', () => {
    const config = validGateRoute();
    (config.verification.gateRoute.checks[0] as { timeoutSeconds: number }).timeoutSeconds = 0;
    expect(() => verificationConfigSchema.parse(config)).toThrow();
  });
});
