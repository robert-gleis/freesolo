import fs from 'node:fs/promises';
import path from 'node:path';

import type { SessionState } from '../core/session-state.js';
import type { ReviewReportFrontmatter } from './types.js';
import { REPORT_SCHEMA_VERSION } from './types.js';

export interface BuildReviewReportInput {
  repoRoot: string;
  issueNumber: number;
  session: Pick<SessionState, 'reviewGates' | 'reviewLoops' | 'artifacts'>;
  generatedAt: string;
}

export interface ReviewRoundArtifact {
  round: number;
  relativePath: string;
  absolutePath: string;
}

export interface ReviewArtifactSummary {
  verdict: string | null;
  findingsCount: number | 'unknown';
}

function serializeFrontmatter(frontmatter: ReviewReportFrontmatter): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---`;
}

function extractRoundNumber(filename: string, kind: 'plan' | 'implementation'): number | null {
  const match = filename.match(new RegExp(`issue-\\d+-${kind}-review-round-(\\d+)\\.md$`));
  return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

export async function listReviewRoundArtifacts(
  repoRoot: string,
  issueNumber: number,
  kind: 'plan' | 'implementation'
): Promise<ReviewRoundArtifact[]> {
  const reviewsDir = path.join(repoRoot, 'docs', 'issueflow', 'reviews');
  let entries: string[];

  try {
    entries = await fs.readdir(reviewsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const kindMarker = `-${kind}-review-round-`;

  return entries
    .filter((entry) => entry.includes(issueMarker) && entry.includes(kindMarker) && entry.endsWith('.md'))
    .map((entry) => {
      const round = extractRoundNumber(entry, kind);
      return round === null
        ? null
        : {
            round,
            relativePath: path.join('docs', 'issueflow', 'reviews', entry),
            absolutePath: path.join(reviewsDir, entry)
          };
    })
    .filter((artifact): artifact is ReviewRoundArtifact => artifact !== null)
    .sort((left, right) => left.round - right.round);
}

export function parseReviewArtifactSummary(content: string): ReviewArtifactSummary {
  const verdictMatch = content.match(/## Verdict\s*\n([^\n#]+)/);
  const verdict = verdictMatch?.[1]?.trim() ?? null;

  const findingsSection = content.match(/## Findings\s*([\s\S]*?)(?:\n## |\s*$)/);
  if (!findingsSection) {
    return { verdict, findingsCount: verdict ? 0 : 'unknown' };
  }

  const findingHeadings = findingsSection[1]?.match(/^### /gm);
  return {
    verdict,
    findingsCount: findingHeadings ? findingHeadings.length : verdict ? 0 : 'unknown'
  };
}

function gateStatusForRound(round: number, maxCompletedRound: number, finalGateStatus: string): string {
  if (round < maxCompletedRound) {
    return 'pass_with_findings';
  }

  return finalGateStatus;
}

async function collectReviewRoundArtifacts(
  repoRoot: string,
  issueNumber: number,
  kind: 'plan' | 'implementation',
  sessionArtifact: string | null
): Promise<ReviewRoundArtifact[]> {
  const artifacts = await listReviewRoundArtifacts(repoRoot, issueNumber, kind);

  if (!sessionArtifact) {
    return artifacts;
  }

  const basename = path.basename(sessionArtifact);
  const round = extractRoundNumber(basename, kind);

  if (round === null || artifacts.some((artifact) => artifact.round === round)) {
    return artifacts;
  }

  return [
    ...artifacts,
    {
      round,
      relativePath: path.join('docs', 'issueflow', 'reviews', basename),
      absolutePath: sessionArtifact
    }
  ].sort((left, right) => left.round - right.round);
}

async function buildReviewSection(input: {
  kind: 'plan' | 'implementation';
  repoRoot: string;
  issueNumber: number;
  gateStatus: string;
  completedRounds: number;
  sessionArtifact: string | null;
}): Promise<string> {
  const title = input.kind === 'plan' ? 'Plan review' : 'Implementation review';
  const artifacts = await collectReviewRoundArtifacts(
    input.repoRoot,
    input.issueNumber,
    input.kind,
    input.sessionArtifact
  );

  if (artifacts.length === 0) {
    return `## ${title}\n\n_Not started._`;
  }

  const tableHeader = '| Round | Artifact | Gate status | Findings |';
  const tableDivider = '|-------|----------|-------------|----------|';
  const roundSections: string[] = [];

  const rows = await Promise.all(
    artifacts.map(async (artifact) => {
      let summary: ReviewArtifactSummary = { verdict: null, findingsCount: 'unknown' };
      let artifactNote = `\`${artifact.relativePath}\``;

      try {
        const content = await fs.readFile(artifact.absolutePath, 'utf8');
        summary = parseReviewArtifactSummary(content);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          artifactNote = `\`${artifact.relativePath}\` (artifact missing)`;
        } else {
          throw error;
        }
      }

      const gateStatus = gateStatusForRound(artifact.round, input.completedRounds, input.gateStatus);
      const findings =
        summary.findingsCount === 'unknown' ? 'unknown' : String(summary.findingsCount);

      if (summary.verdict) {
        roundSections.push(
          `### Round ${artifact.round} — ${summary.verdict}`,
          '',
          `Artifact: \`${artifact.relativePath}\``,
          ''
        );
      }

      return `| ${artifact.round} | ${artifactNote} | ${gateStatus} | ${findings} |`;
    })
  );

  return [
    `## ${title}`,
    '',
    tableHeader,
    tableDivider,
    ...rows,
    '',
    ...roundSections,
    ''
  ].join('\n');
}

function completedRounds(gateStatus: string, currentRound: number): number {
  if (gateStatus === 'pass') {
    return currentRound;
  }

  if (gateStatus === 'pass_with_findings') {
    return Math.max(0, currentRound - 1);
  }

  return 0;
}

export async function buildReviewReportMarkdown(input: BuildReviewReportInput): Promise<string> {
  const planRoundsCompleted = completedRounds(
    input.session.reviewGates.plan,
    input.session.reviewLoops.plan.currentRound
  );
  const implementationRoundsCompleted = completedRounds(
    input.session.reviewGates.implementation,
    input.session.reviewLoops.implementation.currentRound
  );

  const frontmatter: ReviewReportFrontmatter = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: 'review-report',
    issueNumber: input.issueNumber,
    generatedAt: input.generatedAt,
    planGate: input.session.reviewGates.plan,
    implementationGate: input.session.reviewGates.implementation,
    planRoundsCompleted,
    implementationRoundsCompleted
  };

  const planSection = await buildReviewSection({
    kind: 'plan',
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    gateStatus: input.session.reviewGates.plan,
    completedRounds: frontmatter.planRoundsCompleted,
    sessionArtifact: input.session.artifacts.planReview
  });

  const implementationSection = await buildReviewSection({
    kind: 'implementation',
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    gateStatus: input.session.reviewGates.implementation,
    completedRounds: frontmatter.implementationRoundsCompleted,
    sessionArtifact: input.session.artifacts.implementationReview
  });

  const summaryParts = [
    `Plan review **${input.session.reviewGates.plan}** after ${frontmatter.planRoundsCompleted} round(s).`
  ];

  if (input.session.reviewGates.implementation === 'pending') {
    summaryParts.push('Implementation review not yet completed.');
  } else {
    summaryParts.push(
      `Implementation review **${input.session.reviewGates.implementation}** after ${frontmatter.implementationRoundsCompleted} round(s).`
    );
  }

  return [
    serializeFrontmatter(frontmatter),
    `# Review Report — Issue #${input.issueNumber}`,
    '',
    '## Summary',
    '',
    summaryParts.join(' '),
    '',
    planSection,
    implementationSection
  ].join('\n');
}
