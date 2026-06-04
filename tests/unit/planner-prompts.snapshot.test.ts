import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildDecompositionPrompt,
  buildTeamPrompt
} from '../../src/planner/prompts/index.js';
import { buildRetryPrompt } from '../../src/planner/prompts/retry.js';
import type { PlannerIssue } from '../../src/planner/types.js';

const issue: PlannerIssue = {
  number: 7,
  title: 'Snapshot fixture',
  body: 'Lorem ipsum dolor sit amet.',
  labels: ['enhancement']
};

describe('planner prompts snapshots', () => {
  it('buildTeamPrompt snapshot', () => {
    expect(buildTeamPrompt(issue)).toMatchSnapshot();
  });

  it('buildDecompositionPrompt snapshot', () => {
    expect(buildDecompositionPrompt(issue)).toMatchSnapshot();
  });

  it('buildRetryPrompt has stable preamble and footer; validation block is structural', () => {
    const schema = z.object({ x: z.string() });
    const r = schema.safeParse({ x: 1 });
    if (r.success) throw new Error('expected failure');
    const prompt = buildRetryPrompt(r.error);

    // Split the prompt at the "Validation error:" marker so we can snapshot the
    // structural framing and assert the issue-block shape separately.
    const marker = 'Validation error:';
    const markerIdx = prompt.indexOf(marker);
    expect(markerIdx).toBeGreaterThan(-1);

    const preamble = prompt.slice(0, markerIdx);
    const afterMarker = prompt.slice(markerIdx + marker.length);

    // Footer = everything after the (blank-line-separated) error block.
    const blankLineIdx = afterMarker.indexOf('\n\n');
    expect(blankLineIdx).toBeGreaterThan(-1);
    const errorBlock = afterMarker.slice(0, blankLineIdx);
    const footer = afterMarker.slice(blankLineIdx + 2);

    expect(preamble).toMatchSnapshot('retry-preamble');
    expect(footer).toMatchSnapshot('retry-footer');

    // The error block must look like one-or-more lines of "- <path>: <message>".
    // We deliberately do NOT snapshot the verbatim Zod message text so patch
    // releases of zod don't cause spurious snapshot churn.
    expect(errorBlock).toMatch(/^\n- [^\n]+: [^\n]+(\n- [^\n]+: [^\n]+)*$/);
  });
});
