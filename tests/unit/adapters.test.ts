import { describe, expect, it } from 'vitest';

import { buildCodexLaunchPlan, buildClaudeLaunchPlan, buildCursorLaunchPlan } from '../../src/adapters/index.js';

describe('buildCodexLaunchPlan', () => {
  it('launches codex in the selected worktree', () => {
    const plan = buildCodexLaunchPlan({
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      startupPrompt: 'Continue the issueflow workflow'
    });

    expect(plan.binary).toBe('codex');
    expect(plan.args).toContain('-C');
  });
});

describe('buildClaudeLaunchPlan', () => {
  it('launches claude in the selected worktree', () => {
    const plan = buildClaudeLaunchPlan({
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      startupPrompt: 'Continue the issueflow workflow'
    });

    expect(plan.binary).toBe('claude');
    expect(plan.cwd).toBe('/tmp/issueflow-12-ship-issueflow-start');
  });
});

describe('buildCursorLaunchPlan', () => {
  it('launches cursor-agent in the selected worktree with the startup prompt', () => {
    const plan = buildCursorLaunchPlan({
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      startupPrompt: 'Continue the issueflow workflow'
    });

    expect(plan.binary).toBe('cursor-agent');
    expect(plan.args).toEqual(['--workspace', '/tmp/issueflow-12-ship-issueflow-start', 'Continue the issueflow workflow']);
  });
});
