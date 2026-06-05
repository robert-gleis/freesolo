export type AgentHost = 'pi' | 'claude' | 'codex' | 'cursor';

export interface TeamRole {
  name: string;
  host: AgentHost;
  responsibility: string;
  count: number;
}

export interface TeamDefinition {
  roles: TeamRole[];
}
