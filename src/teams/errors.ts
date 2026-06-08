export type TeamLifecycleErrorCode = 'invalid-state';

export class TeamLifecycleError extends Error {
  readonly code: TeamLifecycleErrorCode;

  constructor(code: TeamLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'TeamLifecycleError';
    this.code = code;
  }
}
