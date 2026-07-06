import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { MergePolicyConfig } from './merge-types.js';

export const mergePolicySchema = z.object({
  mergePolicy: z
    .object({
      requireCandidateBranch: z.boolean().default(true),
      requireImplementationReview: z.boolean().default(true)
    })
    .default({
      requireCandidateBranch: true,
      requireImplementationReview: true
    })
});

const DEFAULT_POLICY: MergePolicyConfig = {
  requireCandidateBranch: true,
  requireImplementationReview: true
};

export async function loadMergePolicy(repoRoot: string): Promise<MergePolicyConfig> {
  const configPath = path.join(repoRoot, '.freesolo', 'merge-policy.json');

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = mergePolicySchema.parse(JSON.parse(raw));
    return parsed.mergePolicy;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_POLICY;
    }

    throw error;
  }
}

export async function defaultMergePolicy(repoRoot: string): Promise<MergePolicyConfig> {
  return loadMergePolicy(repoRoot);
}
