import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command, InvalidArgumentError, Option } from 'commander';
import { execa } from 'execa';

import type { AgentAdapter } from '../agents/index.js';
import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import { getIssueflowPath } from '../core/session-state.js';
import { createChildIssues } from '../github/issues.js';
import {
  assertParentIssueMatches,
  createDefaultDecompositionAgent,
  DecompositionAlreadyAppliedError,
  DecompositionNotFoundError,
  DecompositionValidationError,
  getDecompositionPath,
  readDecomposition,
  readDecompositionApplied,
  runIssueDecomposer,
  validateDecompositionFile,
  writeDecomposition,
  writeDecompositionApplied,
  type PlannerIssue
} from '../planner/index.js';
import type { RepoRef } from '../workflow/state-store.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface DecompositionCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (worktreePath: string, override: number | undefined) => Promise<number>;
  runIssueDecomposer: typeof runIssueDecomposer;
  createDecompositionAgent: (issue: PlannerIssue) => AgentAdapter;
  fetchIssue: (repo: RepoRef, issueNumber: number, worktreePath: string) => Promise<PlannerIssue>;
  readDecomposition: typeof readDecomposition;
  writeDecomposition: typeof writeDecomposition;
  getDecompositionPath: typeof getDecompositionPath;
  readDecompositionApplied: typeof readDecompositionApplied;
  writeDecompositionApplied: typeof writeDecompositionApplied;
  createChildIssues: typeof createChildIssues;
  openEditor: (filePath: string, env: NodeJS.ProcessEnv) => Promise<number>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultResolveRepoRef(cwd: string): Promise<RepoRef> {
  const repoRoot = await resolveRepoRoot(cwd);
  const remoteUrl = await readOriginRemote(repoRoot);
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error('origin is not a supported GitHub remote');
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

async function defaultFetchIssue(
  repo: RepoRef,
  issueNumber: number,
  worktreePath: string
): Promise<PlannerIssue> {
  try {
    const { stdout } = await execa(
      'gh',
      [
        'issue',
        'view',
        String(issueNumber),
        '--repo',
        `${repo.owner}/${repo.repo}`,
        '--json',
        'number,title,body'
      ],
      { cwd: worktreePath }
    );
    const parsed = JSON.parse(stdout) as { number: number; title: string; body?: string };
    return {
      number: parsed.number,
      title: parsed.title,
      body: parsed.body ?? ''
    };
  } catch {
    const packetPath = await getIssueflowPath(worktreePath, 'current-issue.md');
    const markdown = await fs.readFile(packetPath, 'utf8');
    return parseIssuePacket(markdown, issueNumber);
  }
}

function parseIssuePacket(markdown: string, issueNumber: number): PlannerIssue {
  const titleMatch = markdown.match(/^# Issue #\d+: (.+)$/m);
  const bodyMatch = markdown.match(/^## Body\n([\s\S]*)$/m);
  return {
    number: issueNumber,
    title: titleMatch?.[1]?.trim() ?? `Issue #${issueNumber}`,
    body: bodyMatch?.[1]?.trim() ?? ''
  };
}

async function defaultOpenEditor(filePath: string, env: NodeJS.ProcessEnv): Promise<number> {
  const editor = env.EDITOR?.trim() || 'vi';
  const parts = editor.split(/\s+/);
  const command = parts[0];
  const args = [...parts.slice(1), filePath];
  const result = await execa(command, args, {
    env,
    stdio: 'inherit',
    reject: false
  });
  return result.exitCode ?? 1;
}

const defaultDeps: DecompositionCommandDeps = {
  resolveRepoRoot,
  resolveRepoRef: defaultResolveRepoRef,
  resolveIssueNumber: (worktreePath, override) => resolveIssueNumber(worktreePath, override),
  runIssueDecomposer,
  createDecompositionAgent: createDefaultDecompositionAgent,
  fetchIssue: defaultFetchIssue,
  readDecomposition,
  writeDecomposition,
  getDecompositionPath,
  readDecompositionApplied,
  writeDecompositionApplied,
  createChildIssues,
  openEditor: defaultOpenEditor,
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

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

function requireEngineGate(subcommand: string, deps: DecompositionCommandDeps): boolean {
  if (deps.env.ISSUEFLOW_ENGINE === '1') {
    return true;
  }
  deps.write(
    'stderr',
    `issueflow decomposition ${subcommand} is engine-only. Set ISSUEFLOW_ENGINE=1 to authorise the call; agent processes must not bypass the workflow engine.\n`
  );
  deps.setExitCode(3);
  return false;
}

function withCommanderErrorHandling(
  deps: DecompositionCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);

    if (error instanceof IssueIdError) {
      deps.setExitCode(2);
      return;
    }

    deps.setExitCode(1);
  });
}

async function resolveIssueContext(
  deps: DecompositionCommandDeps,
  issueOverride: number | undefined
): Promise<{ issueNumber: number; repo: RepoRef; worktreePath: string }> {
  const worktreePath = await deps.resolveRepoRoot(process.cwd());
  const issueNumber = await deps.resolveIssueNumber(worktreePath, issueOverride);
  const repo = await deps.resolveRepoRef(process.cwd());
  return { issueNumber, repo, worktreePath };
}

export function registerDecompositionCommands(
  program: Command,
  deps: DecompositionCommandDeps = defaultDeps
): Command {
  const decomposition = program
    .command('decomposition')
    .description('Generate, inspect, edit, and approve issue decomposition previews');

  decomposition
    .command('generate')
    .description('Run the decomposition planner and write a preview file')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .option('--force', 'Overwrite an existing preview when decomposition has not been applied')
    .action(async (options: { issue?: number; force?: boolean }) => {
      if (!requireEngineGate('generate', deps)) {
        return;
      }

      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, repo, worktreePath } = await resolveIssueContext(deps, options.issue);
        const applied = await deps.readDecompositionApplied(worktreePath);
        if (applied !== null) {
          throw new DecompositionAlreadyAppliedError();
        }

        if (!options.force) {
          try {
            await deps.readDecomposition(worktreePath);
            deps.write(
              'stderr',
              'decomposition preview already exists; use --force to regenerate\n'
            );
            deps.setExitCode(1);
            return;
          } catch (error) {
            if (!(error instanceof DecompositionNotFoundError)) {
              throw error;
            }
          }
        }

        const issue = await deps.fetchIssue(repo, issueNumber, worktreePath);
        const agent = deps.createDecompositionAgent(issue);
        const result = await deps.runIssueDecomposer({ worktreePath, issue, agent });
        deps.write('stdout', `decomposition preview written: ${result.decompositionPath}\n`);
      });
    });

  decomposition
    .command('show')
    .description('Print the decomposition preview JSON for an issue')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { worktreePath } = await resolveIssueContext(deps, options.issue);
        const plan = await deps.readDecomposition(worktreePath);
        deps.write('stdout', `${JSON.stringify(plan, null, 2)}\n`);
      });
    });

  decomposition
    .command('edit')
    .description('Edit the decomposition preview in $EDITOR')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, worktreePath } = await resolveIssueContext(deps, options.issue);
        const decompositionPath = await deps.getDecompositionPath(worktreePath);
        let original: string;
        try {
          original = await fs.readFile(decompositionPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new DecompositionNotFoundError(decompositionPath);
          }
          throw error;
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-decomposition-edit-'));
        const tempPath = path.join(tempDir, 'decomposition.json');
        await fs.writeFile(tempPath, original);

        const exitCode = await deps.openEditor(tempPath, deps.env);
        if (exitCode !== 0) {
          await fs.rm(tempDir, { recursive: true, force: true });
          deps.write('stderr', `Editor exited with code ${exitCode}.\n`);
          deps.setExitCode(1);
          return;
        }

        const edited = await fs.readFile(tempPath, 'utf8');
        await fs.rm(tempDir, { recursive: true, force: true });

        try {
          const plan = validateDecompositionFile(edited);
          assertParentIssueMatches(plan, issueNumber);
          await deps.writeDecomposition(worktreePath, plan);
          deps.write('stdout', 'decomposition preview updated\n');
        } catch (error) {
          if (error instanceof DecompositionValidationError) {
            deps.write('stderr', `${error.message}\n`);
            deps.setExitCode(1);
            return;
          }
          throw error;
        }
      });
    });

  decomposition
    .command('approve')
    .description('Validate the decomposition preview and create GitHub child issues')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      if (!requireEngineGate('approve', deps)) {
        return;
      }

      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, repo, worktreePath } = await resolveIssueContext(deps, options.issue);
        const applied = await deps.readDecompositionApplied(worktreePath);
        if (applied !== null) {
          if (applied.parent_issue !== issueNumber) {
            throw new DecompositionValidationError(
              `applied decomposition parent_issue ${applied.parent_issue} does not match issue #${issueNumber}`
            );
          }
          for (const child of applied.children) {
            deps.write('stdout', `#${child.number} ${child.title} ${child.url}\n`);
          }
          return;
        }

        const plan = assertParentIssueMatches(await deps.readDecomposition(worktreePath), issueNumber);
        const created = await deps.createChildIssues({
          repo,
          parentIssue: issueNumber,
          children: plan.children
        });
        await deps.writeDecompositionApplied(worktreePath, {
          parent_issue: issueNumber,
          applied_at: new Date().toISOString(),
          children: created
        });
        for (const child of created) {
          deps.write('stdout', `#${child.number} ${child.title} ${child.url}\n`);
        }
      });
    });

  return decomposition;
}
