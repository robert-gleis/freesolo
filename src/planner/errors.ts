export class TeamPlannerError extends Error {
  readonly code: 'agent-failed' | 'invalid-json' | 'validation-failed';

  constructor(code: TeamPlannerError['code'], message: string) {
    super(message);
    this.name = 'TeamPlannerError';
    this.code = code;
  }
}
