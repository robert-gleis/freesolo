import { Command } from 'commander';

import { resolveRepoRoot } from '../core/git.js';
import { listWorktreeEntries } from '../core/worktree.js';
import {
  detectWorktreeDrift,
  getWorktreeStore,
  loadDriftCandidates,
  type WorktreeDriftReport,
  type WorktreeRecord
} from '../worktree-metadata/index.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface WorktreesCommandDeps {
  getWorktreeStore: typeof getWorktreeStore;
  resolveRepoRoot: (cwd: string) => Promise<string>;
  listWorktreeEntries: (repoRoot: string) => Promise<Array<{ branchName: string; worktreePath: string }>>;
  pathExists: (worktreePath: string) => Promise<boolean>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: WorktreesCommandDeps = {
  getWorktreeStore,
  resolveRepoRoot,
  listWorktreeEntries,
  pathExists: async (worktreePath) => {
    try {
      const { access } = await import('node:fs/promises');
      await access(worktreePath);
      return true;
    } catch {
      return false;
    }
  },
  env: process.env,
  write: (channel, message) => {
    if (channel === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  }
};

function formatListTable(rows: WorktreeRecord[]): string {
  if (rows.length === 0) {
    return 'No worktree metadata recorded.\n';
  }

  const header = ['PATH', 'BRANCH', 'ISSUE', 'AGENT', 'LAST SEEN'].join('\t');
  const lines = rows.map((row) =>
    [row.path, row.branch, row.issueId ?? '-', row.agentOwner ?? '-', row.lastSeenAt].join('\t')
  );

  return `${header}\n${lines.join('\n')}\n`;
}

function formatDriftReport(report: WorktreeDriftReport): string {
  const sections: string[] = [];

  if (report.onDiskOnly.length > 0) {
    sections.push('On disk only (no metadata):');
    for (const entry of report.onDiskOnly) {
      sections.push(`  ${entry.path}  ${entry.branch}`);
    }
  }

  if (report.metadataOnly.length > 0) {
    sections.push('Metadata only (missing on disk):');
    for (const row of report.metadataOnly) {
      sections.push(`  ${row.path}  ${row.branch}  issue ${row.issueId ?? '-'}`);
    }
  }

  if (sections.length === 0) {
    return 'No worktree metadata drift detected.\n';
  }

  return `${sections.join('\n')}\n`;
}

async function buildPathExistsMap(
  paths: string[],
  pathExists: WorktreesCommandDeps['pathExists']
): Promise<Map<string, boolean>> {
  const entries = await Promise.all(
    paths.map(async (worktreePath) => [worktreePath, await pathExists(worktreePath)] as const)
  );

  return new Map(entries);
}

function withCommanderErrorHandling(
  deps: WorktreesCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(2);
  });
}

export async function listAction(options: { json?: boolean }, deps: WorktreesCommandDeps = defaultDeps): Promise<void> {
  return withCommanderErrorHandling(deps, async () => {
    const store = deps.getWorktreeStore();
    const rows = store.list();

    if (options.json) {
      deps.write('stdout', `${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    deps.write('stdout', formatListTable(rows));
  });
}

export async function driftAction(options: { json?: boolean }, deps: WorktreesCommandDeps = defaultDeps): Promise<void> {
  return withCommanderErrorHandling(deps, async () => {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    const gitEntries = await deps.listWorktreeEntries(repoRoot);
    const store = deps.getWorktreeStore();
    const allRows = store.list();
    const gitPaths = new Set(gitEntries.map((entry) => entry.worktreePath));
    const uniquePaths = [...new Set(allRows.map((row) => row.path))];
    const pathExistsMap = await buildPathExistsMap(uniquePaths, deps.pathExists);
    const pathExistsSync = (worktreePath: string) => pathExistsMap.get(worktreePath) ?? false;
    const candidates = loadDriftCandidates(allRows, gitPaths, pathExistsSync);
    const report = detectWorktreeDrift(gitEntries, candidates, pathExistsSync);

    if (options.json) {
      deps.write('stdout', `${JSON.stringify(report, null, 2)}\n`);
    } else {
      deps.write('stdout', formatDriftReport(report));
    }

    if (report.onDiskOnly.length > 0 || report.metadataOnly.length > 0) {
      deps.setExitCode(1);
    }
  });
}

export function registerWorktreesCommands(program: Command, deps: WorktreesCommandDeps = defaultDeps): Command {
  const worktrees = program.command('worktrees').description('Inspect persisted worktree metadata');

  worktrees
    .command('list')
    .description('List all persisted worktree metadata')
    .option('--json', 'Print JSON output')
    .action(async (options) => listAction(options, deps));

  worktrees
    .command('drift')
    .description('Compare git worktrees with persisted metadata for the current repository')
    .option('--json', 'Print JSON output')
    .action(async (options) => driftAction(options, deps));

  return worktrees;
}
