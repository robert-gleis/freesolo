import type { ZodError } from 'zod';

export type PlannerErrorCode =
  | 'invalid-options'
  | 'adapter-not-ready'
  | 'adapter-failed'
  | 'extract-failed'
  | 'invalid-output';

export interface PlannerErrorDetails {
  cause?: unknown;
  lastValidationError?: ZodError;
  attempts?: number;
  snippet?: string;
}

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  readonly details: PlannerErrorDetails;

  constructor(
    code: PlannerErrorCode,
    message: string,
    details: PlannerErrorDetails = {}
  ) {
    super(message);
    this.name = 'PlannerError';
    this.code = code;
    this.details = details;
  }
}
