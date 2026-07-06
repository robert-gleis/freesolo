import { describe, expect, it } from 'vitest';

import {
  buildAgentStoppedPayload,
  buildDefaultImplementerRole,
  prepareAgentSpawn
} from '../../src/team/spawn.js';

describe('prepareAgentSpawn', () => {
  it('returns role-framed instructions, log line, and event payload', () => {
    const role = buildDefaultImplementerRole('cursor');
    const result = prepareAgentSpawn({
      issueNumber: 42,
      role,
      workingDirectory: '/wt',
      baseInstructions: 'kernel'
    });

    expect(result.instructions).toContain('## Your Role');
    expect(result.instructions).toContain('Implementer');
    expect(result.logLine).toBe(
      '[freesolo] spawn agent=agent-42-implementer-1 role="Implementer" host=cursor instance=1/1 cwd=/wt'
    );
    expect(result.eventPayload).toEqual({
      roleName: 'Implementer',
      responsibility: role.responsibility,
      host: 'cursor',
      instanceIndex: 1,
      instanceCount: 1,
      workingDirectory: '/wt'
    });
  });

  it('uses explicit agentId when provided', () => {
    const role = buildDefaultImplementerRole('claude');
    const result = prepareAgentSpawn({
      agentId: 'custom-id',
      issueNumber: 1,
      role,
      workingDirectory: '/wt',
      baseInstructions: 'x'
    });
    expect(result.agentId).toBe('custom-id');
  });
});

describe('buildAgentStoppedPayload', () => {
  it('includes roleName for correlation', () => {
    const role = buildDefaultImplementerRole('cursor');
    expect(buildAgentStoppedPayload(role)).toEqual({ roleName: 'Implementer' });
  });
});
