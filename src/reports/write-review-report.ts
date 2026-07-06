import fs from 'node:fs/promises';

import { getFreesoloPath, sessionStateSchema } from '../core/session-state.js';
import { updateSessionReportArtifact } from './session-artifacts.js';
import { writeReviewReportToDisk } from './store.js';

export async function writeReviewReportForRepo(cwd: string): Promise<string | null> {
  const sessionStatePath = await getFreesoloPath(cwd, 'session.json');
  const raw = await fs.readFile(sessionStatePath, 'utf8');
  const session = sessionStateSchema.parse(JSON.parse(raw));

  const reportPath = await writeReviewReportToDisk({
    repoRoot: session.repoRoot,
    issueNumber: session.issueNumber,
    session,
    generatedAt: new Date().toISOString()
  });

  await updateSessionReportArtifact(session.worktreePath, 'reviewReport', reportPath);
  return reportPath;
}
