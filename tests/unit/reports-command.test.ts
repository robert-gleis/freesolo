import { describe, expect, it } from 'vitest';

import { showReports } from '../../src/commands/reports.js';

describe('showReports', () => {
  it('prints not generated yet when reports are missing', async () => {
    const lines: string[] = [];

    await showReports(
      { cwd: '/repo', issue: 30 },
      {
        resolveRepoRoot: async () => '/repo',
        resolveIssueNumber: async () => 30,
        findIssueArtifacts: async () => ({
          spec: null,
          plan: null,
          planReview: null,
          implementationReview: null,
          testReport: null,
          reviewReport: null
        }),
        readFile: async () => '',
        write: (_channel, message) => {
          lines.push(message.trim());
        },
        setExitCode: () => {}
      }
    );

    expect(lines.join('\n')).toContain('testReport: not generated yet');
    expect(lines.join('\n')).toContain('reviewReport: not generated yet');
  });

  it('prints human summaries when reports exist', async () => {
    const lines: string[] = [];

    await showReports(
      { cwd: '/repo', issue: 30 },
      {
        resolveRepoRoot: async () => '/repo',
        resolveIssueNumber: async () => 30,
        findIssueArtifacts: async () => ({
          spec: null,
          plan: null,
          planReview: null,
          implementationReview: null,
          testReport: '/repo/.git/freesolo/reports/issue-30/TEST_REPORT.md',
          reviewReport: '/repo/.git/freesolo/reports/issue-30/REVIEW_REPORT.md'
        }),
        readFile: async (filePath) => {
          if (filePath.endsWith('TEST_REPORT.md')) {
            return '---\nstatus: pass\ncheckCount: 3\npassedCount: 3\n---\n';
          }

          return '---\nplanGate: pass\nimplementationGate: pending\n---\n';
        },
        write: (_channel, message) => {
          lines.push(message.trim());
        },
        setExitCode: () => {}
      }
    );

    expect(lines.join('\n')).toContain('test: pass, 3/3 checks');
    expect(lines.join('\n')).toContain('review: plan pass, implementation pending');
  });

  it('returns structured JSON when requested', async () => {
    const lines: string[] = [];

    const result = await showReports(
      { cwd: '/repo', issue: 30, json: true },
      {
        resolveRepoRoot: async () => '/repo',
        resolveIssueNumber: async () => 30,
        findIssueArtifacts: async () => ({
          spec: null,
          plan: null,
          planReview: null,
          implementationReview: null,
          testReport: null,
          reviewReport: null
        }),
        readFile: async () => '',
        write: (_channel, message) => {
          lines.push(message.trim());
        },
        setExitCode: () => {}
      }
    );

    expect(result).toEqual({
      issueNumber: 30,
      testReport: null,
      reviewReport: null
    });
    expect(JSON.parse(lines[0] ?? '{}')).toEqual(result);
  });

});
