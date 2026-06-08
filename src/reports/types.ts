export const REPORT_SCHEMA_VERSION = 1 as const;

export interface TestReportFrontmatter {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  kind: 'test-report';
  issueNumber: number;
  runId: string;
  status: 'pass' | 'fail';
  generatedAt: string;
  repoRoot: string;
  configPath: string;
  bail: boolean;
  checkCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  runDirectory: string;
}

export interface ReviewReportFrontmatter {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  kind: 'review-report';
  issueNumber: number;
  generatedAt: string;
  planGate: string;
  implementationGate: string;
  planRoundsCompleted: number;
  implementationRoundsCompleted: number;
}
