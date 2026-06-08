import { describe, expect, it, vi } from 'vitest';

import { EventLogError } from '../../src/event-log/types.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import { TeamPlanValidationError } from '../../src/planner/store.js';
import { maybeAutoApproveTeamPlan } from '../../src/policy/autonomous-approval.js';
import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import type { RepoRef } from '../../src/workflow/state-store.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
const definition: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship', count: 1 }]
};

describe('maybeAutoApproveTeamPlan', () => {
  it('returns skipped when autonomous mode is off', async () => {
    const readTeamPlan = vi.fn();
    const writeState = vi.fn();
    const appendEvent = vi.fn();
    const result = await maybeAutoApproveTeamPlan(
      {
        repoRoot: '/repo',
        worktreePath: '/repo',
        repo,
        issueNumber: 45,
        teamPlanPath: '/repo/.git/issueflow/team-plan.json'
      },
      {
        resolveAutonomousMode: vi.fn().mockResolvedValue(false),
        readTeamPlan,
        writeState,
        appendEvent
      }
    );
    expect(result).toEqual({ status: 'skipped' });
    expect(readTeamPlan).not.toHaveBeenCalled();
    expect(writeState).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('transitions planned to approved and appends team.planned when on', async () => {
    const writeState = vi.fn().mockResolvedValue(undefined);
    const appendEvent = vi.fn();
    const readTeamPlan = vi.fn().mockResolvedValue(definition);
    const teamPlanPath = '/repo/.git/issueflow/team-plan.json';

    const result = await maybeAutoApproveTeamPlan(
      { repoRoot: '/repo', worktreePath: '/repo', repo, issueNumber: 45, teamPlanPath },
      {
        resolveAutonomousMode: vi.fn().mockResolvedValue(true),
        readTeamPlan,
        writeState,
        appendEvent
      }
    );

    expect(result).toEqual({ status: 'approved', teamPlanPath });
    expect(writeState).toHaveBeenCalledWith(repo, 45, 'planned', 'approved');
    expect(readTeamPlan).toHaveBeenCalledWith('/repo');
    expect(appendEvent).toHaveBeenCalledWith({
      eventType: 'team.planned',
      issueId: 45,
      payload: { teamPlanPath, autonomous: true }
    });
  });

  it('propagates TeamPlanValidationError without writing state', async () => {
    const writeState = vi.fn();
    await expect(
      maybeAutoApproveTeamPlan(
        {
          repoRoot: '/repo',
          worktreePath: '/repo',
          repo,
          issueNumber: 45,
          teamPlanPath: '/repo/.git/issueflow/team-plan.json'
        },
        {
          resolveAutonomousMode: vi.fn().mockResolvedValue(true),
          readTeamPlan: vi.fn().mockRejectedValue(new TeamPlanValidationError('invalid plan')),
          writeState,
          appendEvent: vi.fn()
        }
      )
    ).rejects.toThrow(TeamPlanValidationError);
    expect(writeState).not.toHaveBeenCalled();
  });

  it('propagates InvalidTransitionError without appending event', async () => {
    const appendEvent = vi.fn();
    await expect(
      maybeAutoApproveTeamPlan(
        {
          repoRoot: '/repo',
          worktreePath: '/repo',
          repo,
          issueNumber: 45,
          teamPlanPath: '/repo/.git/issueflow/team-plan.json'
        },
        {
          resolveAutonomousMode: vi.fn().mockResolvedValue(true),
          readTeamPlan: vi.fn().mockResolvedValue(definition),
          writeState: vi.fn().mockRejectedValue(
            new InvalidTransitionError('planned', 'approved', ['triaged'])
          ),
          appendEvent
        }
      )
    ).rejects.toThrow(InvalidTransitionError);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('propagates EventLogError after writeState succeeds', async () => {
    const writeState = vi.fn().mockResolvedValue(undefined);
    const appendEvent = vi.fn().mockImplementation(() => {
      throw new EventLogError('append-failed', 'db locked');
    });
    await expect(
      maybeAutoApproveTeamPlan(
        {
          repoRoot: '/repo',
          worktreePath: '/repo',
          repo,
          issueNumber: 45,
          teamPlanPath: '/repo/.git/issueflow/team-plan.json'
        },
        {
          resolveAutonomousMode: vi.fn().mockResolvedValue(true),
          readTeamPlan: vi.fn().mockResolvedValue(definition),
          writeState,
          appendEvent
        }
      )
    ).rejects.toThrow(EventLogError);
    expect(writeState).toHaveBeenCalledWith(repo, 45, 'planned', 'approved');
  });
});
