import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { z } from 'zod';

import type { HostTool, ReviewGateStatus, ReviewLoopsState } from './types.js';

const reviewGateStatusValues = ['pending', 'pass', 'pass_with_findings', 'block'] as const;
const reviewGateStatusSchema = z.enum(reviewGateStatusValues) as z.ZodType<ReviewGateStatus>;
const defaultReviewLoops: ReviewLoopsState = {
  plan: {
    currentRound: 1,
    maxRounds: 5
  },
  implementation: {
    currentRound: 1,
    maxRounds: 5
  }
};
const reviewLoopSchema = z.object({
  currentRound: z.number().int().min(1).max(5).default(1),
  maxRounds: z.literal(5).default(5)
});

export const sessionStateSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueSlug: z.string().min(1),
  repoRoot: z.string().min(1),
  branchName: z.string().min(1),
  worktreePath: z.string().min(1),
  chosenHost: z.enum(['codex', 'claude', 'cursor']) as z.ZodType<HostTool>,
  currentStage: z.enum([
    'issue-intake',
    'brainstorming',
    'spec',
    'user-review',
    'planning',
    'plan-review',
    'implementation',
    'implementation-review',
    'verification'
  ]),
  reviewGates: z.object({
    plan: reviewGateStatusSchema,
    implementation: reviewGateStatusSchema
  }),
  reviewLoops: z
    .object({
      plan: reviewLoopSchema.default(defaultReviewLoops.plan),
      implementation: reviewLoopSchema.default(defaultReviewLoops.implementation)
    })
    .default(defaultReviewLoops),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  artifacts: z.object({
    spec: z.string().nullable(),
    plan: z.string().nullable(),
    planReview: z.string().nullable(),
    implementationReview: z.string().nullable()
  })
});

export type SessionState = z.infer<typeof sessionStateSchema>;

export async function getIssueflowDir(worktreePath: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--git-path', 'issueflow'], { cwd: worktreePath });
  return stdout.trim();
}

export async function getIssueflowPath(worktreePath: string, filename: string): Promise<string> {
  const issueflowDir = await getIssueflowDir(worktreePath);
  return path.join(issueflowDir, filename);
}

export async function writeSessionState(worktreePath: string, state: SessionState): Promise<void> {
  const sessionStatePath = await getIssueflowPath(worktreePath, 'session.json');
  await fs.mkdir(path.dirname(sessionStatePath), { recursive: true });
  await fs.writeFile(sessionStatePath, JSON.stringify(state, null, 2));
}

export async function writeIssuePacket(worktreePath: string, markdown: string): Promise<void> {
  const issuePacketPath = await getIssueflowPath(worktreePath, 'current-issue.md');
  await fs.mkdir(path.dirname(issuePacketPath), { recursive: true });
  await fs.writeFile(issuePacketPath, markdown);
}
