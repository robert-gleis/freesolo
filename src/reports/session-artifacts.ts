import fs from 'node:fs/promises';
import path from 'node:path';

import { getIssueflowPath, sessionStateSchema, writeSessionState } from '../core/session-state.js';

export type ReportArtifactField = 'testReport' | 'reviewReport';

export async function updateSessionReportArtifact(
  worktreePath: string,
  field: ReportArtifactField,
  artifactPath: string
): Promise<void> {
  const sessionStatePath = await getIssueflowPath(worktreePath, 'session.json');

  let raw: string;
  try {
    raw = await fs.readFile(sessionStatePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const session = sessionStateSchema.parse(JSON.parse(raw));
  session.artifacts[field] = artifactPath;
  session.updatedAt = new Date().toISOString();
  await writeSessionState(worktreePath, session);
}
