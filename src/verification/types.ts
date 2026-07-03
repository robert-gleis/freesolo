import { z } from 'zod';

import { HOST_TOOLS } from '../core/types.js';

const checkNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const checkNameSchema = z
  .string()
  .regex(checkNamePattern, 'Check name must match /^[a-z0-9][a-z0-9-]{0,63}$/');
const promptPresetSchema = z.string().min(1, 'promptPreset must not be empty');
const timeoutSecondsSchema = z.number().int().positive('timeoutSeconds must be a positive integer');
// Built from HOST_TOOLS so the route stays host-agnostic (no hardcoded host, no 'pi').
const hostToolSchema = z.enum(HOST_TOOLS);

export const shellCheckSchema = z.strictObject({
  name: checkNameSchema,
  kind: z.literal('shell'),
  command: z.string().min(1, 'Shell check command must not be empty'),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  timeoutSeconds: timeoutSecondsSchema.optional()
});

export const agentReviewCheckSchema = z.strictObject({
  name: checkNameSchema,
  kind: z.literal('agent-review'),
  host: hostToolSchema,
  promptPreset: promptPresetSchema,
  timeoutSeconds: timeoutSecondsSchema.optional()
});

export const routeCheckSchema = z.discriminatedUnion('kind', [shellCheckSchema, agentReviewCheckSchema]);

export const fixerSpecSchema = z.strictObject({
  host: hostToolSchema,
  promptPreset: promptPresetSchema,
  timeoutSeconds: timeoutSecondsSchema.optional()
});

export const gateRouteConfigSchema = z.strictObject({
  maxAttempts: z.number().int().min(1, 'maxAttempts must be an integer >= 1'),
  bail: z.boolean(),
  checks: z.array(routeCheckSchema).min(1, 'gateRoute.checks must contain at least one check'),
  fixer: fixerSpecSchema
});

// strictObject rejects the old `verification.checks` shape and any unknown key.
export const verificationConfigSchema = z.strictObject({
  verification: z.strictObject({
    gateRoute: gateRouteConfigSchema
  })
});

export type ShellCheck = z.infer<typeof shellCheckSchema>;
export type AgentReviewCheck = z.infer<typeof agentReviewCheckSchema>;
export type RouteCheck = z.infer<typeof routeCheckSchema>;
export type FixerSpec = z.infer<typeof fixerSpecSchema>;
export type GateRouteConfig = z.infer<typeof gateRouteConfigSchema>;
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
