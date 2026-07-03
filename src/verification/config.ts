import fs from 'node:fs/promises';
import path from 'node:path';

import { hasPreset, KNOWN_PRESETS } from '../prompts/presets.js';
import { verificationConfigSchema, type VerificationConfig } from './types.js';

export const DEFAULT_CONFIG_FILENAME = 'issueflow.config.json';

export class VerificationConfigError extends Error {
  readonly configPath: string;

  constructor(message: string, configPath: string) {
    super(message);
    this.name = 'VerificationConfigError';
    this.configPath = configPath;
  }
}

function resolveConfigPath(repoRoot: string, configPath: string | undefined): string {
  const candidate = configPath ?? DEFAULT_CONFIG_FILENAME;
  return path.isAbsolute(candidate) ? candidate : path.join(repoRoot, candidate);
}

export async function loadVerificationConfig(repoRoot: string, configPath?: string): Promise<VerificationConfig> {
  const resolvedPath = resolveConfigPath(repoRoot, configPath);
  let raw: string;

  try {
    raw = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      throw new VerificationConfigError(`Verification config not found at ${resolvedPath}`, resolvedPath);
    }

    throw error;
  }

  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new VerificationConfigError(
      `Verification config at ${resolvedPath} is not valid JSON: ${(error as Error).message}`,
      resolvedPath
    );
  }

  const parsed = verificationConfigSchema.safeParse(json);

  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new VerificationConfigError(`Verification config at ${resolvedPath} is invalid: ${summary}`, resolvedPath);
  }

  assertKnownPresets(parsed.data, resolvedPath);

  return parsed.data;
}

// Zod validates promptPreset only as a non-empty string so the schema stays
// decoupled from the prompt builders. Every agent-review check and the fixer must
// still name a preset the registry actually knows — an unknown preset is a config
// error (spec: invalid verification.gateRoute exits with code 2), not a run-time
// throw deep inside the route.
function assertKnownPresets(config: VerificationConfig, resolvedPath: string): void {
  const { checks, fixer } = config.verification.gateRoute;
  const referenced: Array<{ where: string; preset: string }> = [
    ...checks
      .filter((check) => check.kind === 'agent-review')
      .map((check) => ({ where: `check "${check.name}"`, preset: check.promptPreset })),
    { where: 'fixer', preset: fixer.promptPreset }
  ];

  const unknown = referenced.filter((entry) => !hasPreset(entry.preset));
  if (unknown.length > 0) {
    const detail = unknown.map((entry) => `${entry.where}: "${entry.preset}"`).join('; ');
    throw new VerificationConfigError(
      `Verification config at ${resolvedPath} references unknown prompt preset(s): ${detail} (known: ${KNOWN_PRESETS.join(', ')}).`,
      resolvedPath
    );
  }
}
