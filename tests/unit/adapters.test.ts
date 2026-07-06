import { describe, expect, it } from 'vitest';

import { buildCodexLaunchPlan, buildClaudeLaunchPlan, buildCursorLaunchPlan } from '../../src/adapters/index.js';

describe('buildCodexLaunchPlan', () => {
  it('launches codex in the selected worktree', () => {
    const plan = buildCodexLaunchPlan({
      worktreePath: '/tmp/freesolo-12-ship-freesolo-start',
      startupPrompt: 'Continue the freesolo workflow'
    });

    expect(plan.binary).toBe('codex');
    expect(plan.args).toContain('-C');
  });
});

describe('buildClaudeLaunchPlan', () => {
  it('launches claude in the selected worktree', () => {
    const plan = buildClaudeLaunchPlan({
      worktreePath: '/tmp/freesolo-12-ship-freesolo-start',
      startupPrompt: 'Continue the freesolo workflow'
    });

    expect(plan.binary).toBe('claude');
    expect(plan.cwd).toBe('/tmp/freesolo-12-ship-freesolo-start');
  });
});

describe('buildCursorLaunchPlan', () => {
  it('launches cursor-agent in the selected worktree with the startup prompt', () => {
    const plan = buildCursorLaunchPlan({
      worktreePath: '/tmp/freesolo-12-ship-freesolo-start',
      startupPrompt: 'Continue the freesolo workflow'
    });

    expect(plan.binary).toBe('cursor-agent');
    expect(plan.args).toEqual(['--workspace', '/tmp/freesolo-12-ship-freesolo-start', 'Continue the freesolo workflow']);
  });
});
