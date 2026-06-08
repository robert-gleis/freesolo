import type { ZodError } from 'zod';

export function buildRetryPrompt(error: ZodError): string {
  const formatted = formatZodError(error);
  return [
    'The previous response did not match the required schema.',
    '',
    'Validation error:',
    formatted,
    '',
    'Respond again with a single JSON object that matches the schema exactly. No explanations, no markdown.'
  ].join('\n');
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}
