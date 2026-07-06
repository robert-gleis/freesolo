import { Command } from 'commander';

import { readTeamRuntimeSnapshot } from '../teams/index.js';
import type { TeamRuntimeSnapshot } from '../teams/types.js';
import { getWorktreeStore, type WorktreeRecord } from '../worktree-metadata/index.js';
import { defaultSetExitCode, defaultWrite, type WriteChannel } from './shared.js';

export interface AgentsCommandDeps {
  getWorktreeStore: typeof getWorktreeStore;
  readTeamRuntimeSnapshot: typeof readTeamRuntimeSnapshot;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: AgentsCommandDeps = {
  getWorktreeStore,
  readTeamRuntimeSnapshot,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

export interface AgentsListEntry {
  worktree: WorktreeRecord;
  snapshot: TeamRuntimeSnapshot | null;
}

async function collectEntries(deps: AgentsCommandDeps): Promise<AgentsListEntry[]> {
  const rows = deps.getWorktreeStore().list();

  return Promise.all(
    rows.map(async (worktree) => {
      // ponytail: missing/deleted worktree paths read as "no team" instead of failing the whole listing
      const snapshot = await deps.readTeamRuntimeSnapshot(worktree.path).catch(() => null);
      return { worktree, snapshot };
    })
  );
}

function isActive(entry: AgentsListEntry): boolean {
  return entry.snapshot !== null && entry.snapshot.phase !== 'stopped';
}

function formatTable(entries: AgentsListEntry[]): string {
  if (entries.length === 0) {
    return 'No agent teams found.\n';
  }

  const header = ['ISSUE', 'PHASE', 'MEMBER', 'ROLE', 'HOST', 'STATE', 'BLOCKED', 'WORKTREE'].join('\t');
  const lines: string[] = [];

  for (const { worktree, snapshot } of entries) {
    if (snapshot === null) {
      lines.push([worktree.issueId ?? '-', 'no team', '-', '-', '-', '-', '-', worktree.path].join('\t'));
      continue;
    }
    if (snapshot.members.length === 0) {
      lines.push([snapshot.issueNumber, snapshot.phase, '-', '-', '-', '-', '-', worktree.path].join('\t'));
      continue;
    }
    for (const member of snapshot.members) {
      lines.push(
        [
          snapshot.issueNumber,
          snapshot.phase,
          member.memberId,
          member.roleName,
          member.host,
          member.state,
          member.blockedReason ?? '-',
          worktree.path
        ].join('\t')
      );
    }
  }

  return `${header}\n${lines.join('\n')}\n`;
}

export async function agentsListAction(
  options: { json?: boolean; all?: boolean },
  deps: AgentsCommandDeps = defaultDeps
): Promise<void> {
  try {
    const entries = await collectEntries(deps);
    const visible = options.all ? entries : entries.filter(isActive);

    if (options.json) {
      deps.write('stdout', `${JSON.stringify(visible, null, 2)}\n`);
      return;
    }

    deps.write('stdout', formatTable(visible));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(2);
  }
}

export function registerAgentsCommands(program: Command, deps: AgentsCommandDeps = defaultDeps): Command {
  const agents = program.command('agents').description('Inspect agent teams across all worktrees');

  agents
    .command('list')
    .description('List running agent teams across all tracked worktrees')
    .option('--all', 'Include stopped teams and worktrees without a team')
    .option('--json', 'Print JSON output')
    .action(async (options) => agentsListAction(options, deps));

  return agents;
}
