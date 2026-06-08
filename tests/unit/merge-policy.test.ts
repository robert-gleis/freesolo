import { describe, expect, it } from 'vitest';

import { defaultMergePolicy, mergePolicySchema } from '../../src/integration/merge-policy.js';

describe('mergePolicySchema', () => {
  it('defaults require flags to true', () => {
    const parsed = mergePolicySchema.parse({});
    expect(parsed.mergePolicy.requireCandidateBranch).toBe(true);
    expect(parsed.mergePolicy.requireImplementationReview).toBe(true);
  });
});

describe('defaultMergePolicy', () => {
  it('returns schema defaults when file missing', async () => {
    const policy = await defaultMergePolicy('/nonexistent/repo');
    expect(policy.requireCandidateBranch).toBe(true);
    expect(policy.requireImplementationReview).toBe(true);
  });
});
