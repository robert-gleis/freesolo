import { z } from 'zod';

const checkNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const verificationCheckSpecSchema = z.object({
  name: z.string().regex(checkNamePattern, 'Check name must match /^[a-z0-9][a-z0-9-]{0,63}$/'),
  command: z.string().min(1, 'Check command must not be empty'),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({})
});

export const verificationConfigSchema = z.object({
  verification: z.object({
    checks: z
      .array(verificationCheckSpecSchema)
      .min(1, 'verification.checks must contain at least one check')
      .refine(
        (checks) => new Set(checks.map((check) => check.name)).size === checks.length,
        { message: 'verification.checks names must be unique' }
      )
  })
});

export type VerificationCheckSpec = z.infer<typeof verificationCheckSpecSchema>;
export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

export type CheckStatus = 'pass' | 'fail' | 'skipped';
export type RunStatus = 'pass' | 'fail';

export interface CheckResult {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  status: CheckStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  logPath: string;
}

export interface VerificationRun {
  schemaVersion: 1;
  runId: string;
  issueNumber: number;
  repoRoot: string;
  configPath: string;
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  bail: boolean;
  checks: CheckResult[];
}
