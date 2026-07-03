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
  // ponytail: left as `number` rather than tightened to literal `2`. The route
  // run is the only *runtime* writer, but the consumer tests (verification-store,
  // pr-command, gate-command, gate-pr-command) deliberately construct plain
  // `schemaVersion: 1` VerificationRun fixtures to prove those consumers (gate,
  // pr, merge, reports) read ONLY status/runId and ignore the version. Tightening
  // to `2` here would churn 6+ unrelated fixtures for zero runtime benefit; the
  // GateRouteRun subtype already pins `schemaVersion: 2` where it actually matters.
  schemaVersion: number;
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

/**
 * Result of a single check within one Gate Route attempt.
 * Shell checks carry command/exitCode; agent-review checks carry findings.
 */
export interface RouteCheckResult {
  name: string;
  kind: RouteCheck['kind'];
  status: CheckStatus;
  command: string | null;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  logPath: string;
  // agent-review only: blocking findings summary when the review failed.
  reviewFindings?: string | null;
}

/** One full pass over the route's checks. */
export interface AttemptRecord {
  attempt: number;
  status: RunStatus;
  checks: RouteCheckResult[];
}

/** Result of invoking the Fixer Agent between two attempts. */
export interface FixerInvocationResult {
  afterAttempt: number;
  status: RunStatus;
  logPath: string;
  detail: string;
}

/**
 * Machine-readable evidence for one Gate Route run. It is a superset of
 * VerificationRun: `checks` mirrors the final attempt's check results so the
 * existing pr-body / test-report / gate consumers read it unchanged, while the
 * route-specific fields below carry the per-attempt and fixer evidence.
 */
export interface GateRouteRun extends VerificationRun {
  schemaVersion: 2;
  candidateBranch: string | null;
  routeConfigPath: string;
  maxAttempts: number;
  attemptsUsed: number;
  attempts: AttemptRecord[];
  reviewArtifactPaths: string[];
  fixerInvocations: FixerInvocationResult[];
}
