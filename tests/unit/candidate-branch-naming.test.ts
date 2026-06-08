import { describe, expect, it } from 'vitest';

import { buildCandidateBranchName } from '../../src/integration/naming.js';

describe('buildCandidateBranchName', () => {
  it('formats candidate/<number>-<slug>', () => {
    expect(buildCandidateBranchName(35, 'candidate-branch-creation')).toBe(
      'candidate/35-candidate-branch-creation'
    );
  });
});
