import type { MergeReadinessEvaluation } from './merge-types.js';

export function buildMergeReadinessComment(
  evaluation: MergeReadinessEvaluation,
  evaluatedAt: string
): string {
  const rows = evaluation.checks
    .map((gate) => `| ${gate.label} | ${gate.status} | ${gate.detail} |`)
    .join('\n');

  return `## FreeSolo Merge Readiness

**Verdict:** ${evaluation.outcome}
**Evaluated:** ${evaluatedAt}

| Gate | Status | Detail |
| --- | --- | --- |
${rows}

<!-- freesolo-merge-readiness -->
`;
}
