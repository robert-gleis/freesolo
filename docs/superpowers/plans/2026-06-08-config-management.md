# Config Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repo-level config support and an `freesolo config` CLI (get/set/show/init) that merges global and repo configs with repo taking precedence.

**Architecture:** Extend `src/config/load.ts` to accept an optional `repoRoot` and merge a second config file; add `src/config/write.ts` for in-place YAML key replacement and template generation; add `src/commands/config.ts` with all four subcommands wired through a deps-injection object.

**Tech Stack:** TypeScript (NodeNext modules), Vitest, Commander.js, `node:fs/promises`, `node:path`, `node:os`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `src/config/load.ts` | Add `repoConfigPath()`, partial-parse helpers, `loadConfigWithOrigins()`, update `loadConfig(globalPath?, repoRoot?)` |
| Create | `src/config/write.ts` | `setConfigKey()`, `initConfigFile()`, in-place YAML manipulation |
| Create | `src/commands/config.ts` | `registerConfigCommands()` with get/set/show/init subcommands via deps injection |
| Modify | `src/cli.ts` | Import and call `registerConfigCommands(program)` |
| Create | `tests/unit/config-load.test.ts` | Tests for merged loading and origin tracking |
| Create | `tests/unit/config-write.test.ts` | Tests for setConfigKey and initConfigFile |
| Create | `tests/unit/config-command.test.ts` | Tests for all four CLI subcommands |

---

## Task 1: Extend `loadConfig` for repo-level config and origins

**Files:**
- Modify: `src/config/load.ts`
- Create: `tests/unit/config-load.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/config-load.test.ts`:

```typescript
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, loadConfigWithOrigins, repoConfigPath } from '../../src/config/load.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('repoConfigPath', () => {
  it('returns .freesolo/config.yaml inside the given root', () => {
    expect(repoConfigPath('/my/repo')).toBe('/my/repo/.freesolo/config.yaml');
  });
});

describe('loadConfig with repoRoot', () => {
  it('returns defaults when neither global nor repo config exists', async () => {
    const dir = await makeTempDir();
    const config = await loadConfig(path.join(dir, 'global.yaml'), dir);
    expect(config.state_backend).toBe('github-labels');
    expect(config.autonomous_mode).toBe(false);
    expect(config.watcher.interval_seconds).toBe(60);
    expect(config.watcher.trigger_label).toBe('state:triaged');
  });

  it('repo config overrides global config per-field', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'state_backend: local\nautonomous_mode: true\n');
    const repoDir = await makeTempDir();
    await fs.mkdir(path.join(repoDir, '.freesolo'), { recursive: true });
    await fs.writeFile(path.join(repoDir, '.freesolo', 'config.yaml'), 'state_backend: github-labels\n');
    const config = await loadConfig(globalPath, repoDir);
    expect(config.state_backend).toBe('github-labels'); // repo wins
    expect(config.autonomous_mode).toBe(true);           // falls back to global
  });

  it('global config applies when no repo config exists', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const repoDir = await makeTempDir();
    const config = await loadConfig(globalPath, repoDir);
    expect(config.autonomous_mode).toBe(true);
  });
});

describe('loadConfigWithOrigins', () => {
  it('marks all keys as default when no config files exist', async () => {
    const dir = await makeTempDir();
    const { origins } = await loadConfigWithOrigins(path.join(dir, 'global.yaml'), dir);
    expect(origins.state_backend).toBe('default');
    expect(origins.autonomous_mode).toBe('default');
    expect(origins['watcher.interval_seconds']).toBe('default');
    expect(origins['watcher.trigger_label']).toBe('default');
  });

  it('marks a key as global when set only in global config', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'state_backend: local\n');
    const { origins } = await loadConfigWithOrigins(globalPath, dir);
    expect(origins.state_backend).toBe('global');
    expect(origins.autonomous_mode).toBe('default');
  });

  it('marks a key as repo when set in repo config', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeTempDir();
    await fs.mkdir(path.join(repoDir, '.freesolo'), { recursive: true });
    await fs.writeFile(path.join(repoDir, '.freesolo', 'config.yaml'), 'autonomous_mode: true\n');
    const { origins } = await loadConfigWithOrigins(path.join(dir, 'global.yaml'), repoDir);
    expect(origins.autonomous_mode).toBe('repo');
    expect(origins.state_backend).toBe('default');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/config-load.test.ts
```

Expected: FAIL — `repoConfigPath`, `loadConfigWithOrigins` not exported.

- [ ] **Step 3: Implement the changes in `src/config/load.ts`**

Replace the full file with:

```typescript
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_SECONDS,
  type FreesoloConfig,
  type StateBackend,
  type WatcherConfig
} from './types.js';

export type ConfigOrigin = 'default' | 'global' | 'repo';

export interface ConfigWithOrigins {
  config: FreesoloConfig;
  origins: {
    state_backend: ConfigOrigin;
    autonomous_mode: ConfigOrigin;
    'watcher.interval_seconds': ConfigOrigin;
    'watcher.trigger_label': ConfigOrigin;
  };
}

export interface RawConfig {
  state_backend?: StateBackend;
  autonomous_mode?: boolean;
  watcher?: Partial<WatcherConfig>;
}

export function defaultConfigPath(): string {
  return process.env.FREESOLO_CONFIG ?? path.join(os.homedir(), '.freesolo', 'config.yaml');
}

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, '.freesolo', 'config.yaml');
}

function parseWatcherBlock(lines: string[]): Partial<WatcherConfig> {
  const result: Partial<WatcherConfig> = {};
  let inWatcher = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'watcher:') {
      inWatcher = true;
      continue;
    }
    if (inWatcher && /^[A-Za-z]/.test(line) && !line.startsWith(' ')) {
      break;
    }
    if (!inWatcher) continue;

    const match = line.match(/^\s+(\w+):\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, '').trim();

    if (key === 'interval_seconds') {
      result.interval_seconds = Number.parseInt(value, 10);
    } else if (key === 'trigger_label') {
      result.trigger_label = value;
    }
  }

  return result;
}

export function parseAutonomousModeFromContent(
  content: string,
  configPath: string
): boolean | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    const match = line.match(/^autonomous_mode:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, '').trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${configPath}: autonomous_mode must be true or false`);
  }
  return undefined;
}

export function parseStateBackendFromContent(
  content: string,
  configPath: string
): StateBackend | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    const match = line.match(/^state_backend:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, '').trim();
    if (value === 'github-labels' || value === 'local') return value;
    throw new Error(`${configPath}: state_backend must be "github-labels" or "local"`);
  }
  return undefined;
}

function validateWatcher(configPath: string, watcher: WatcherConfig): void {
  if (!Number.isFinite(watcher.interval_seconds) || watcher.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`${configPath}: watcher.interval_seconds must be >= ${MIN_INTERVAL_SECONDS}`);
  }
  if (!watcher.trigger_label.trim()) {
    throw new Error(`${configPath}: watcher.trigger_label must be non-empty`);
  }
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseRawConfig(content: string, configPath: string): RawConfig {
  const lines = content.split('\n');
  const watcherPartial = parseWatcherBlock(lines);
  return {
    state_backend: parseStateBackendFromContent(content, configPath),
    autonomous_mode: parseAutonomousModeFromContent(content, configPath),
    watcher: Object.keys(watcherPartial).length > 0 ? watcherPartial : undefined
  };
}

export async function loadConfig(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<FreesoloConfig> {
  const globalContent = await readFileOrNull(globalPath);
  const globalRaw = globalContent ? parseRawConfig(globalContent, globalPath) : {};

  let repoRaw: RawConfig = {};
  if (repoRoot) {
    const repoPath = repoConfigPath(repoRoot);
    const repoContent = await readFileOrNull(repoPath);
    if (repoContent) repoRaw = parseRawConfig(repoContent, repoPath);
  }

  const watcher: WatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...globalRaw.watcher,
    ...repoRaw.watcher
  };
  const configPath = repoRoot ? repoConfigPath(repoRoot) : globalPath;
  validateWatcher(configPath, watcher);

  return {
    watcher,
    autonomous_mode: repoRaw.autonomous_mode ?? globalRaw.autonomous_mode ?? DEFAULT_CONFIG.autonomous_mode,
    state_backend: repoRaw.state_backend ?? globalRaw.state_backend ?? DEFAULT_CONFIG.state_backend
  };
}

export async function loadConfigWithOrigins(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<ConfigWithOrigins> {
  const globalContent = await readFileOrNull(globalPath);
  const globalRaw = globalContent ? parseRawConfig(globalContent, globalPath) : {};

  let repoRaw: RawConfig = {};
  if (repoRoot) {
    const repoPath = repoConfigPath(repoRoot);
    const repoContent = await readFileOrNull(repoPath);
    if (repoContent) repoRaw = parseRawConfig(repoContent, repoPath);
  }

  const watcher: WatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...globalRaw.watcher,
    ...repoRaw.watcher
  };
  const configPath = repoRoot ? repoConfigPath(repoRoot) : globalPath;
  validateWatcher(configPath, watcher);

  const config: FreesoloConfig = {
    watcher,
    autonomous_mode: repoRaw.autonomous_mode ?? globalRaw.autonomous_mode ?? DEFAULT_CONFIG.autonomous_mode,
    state_backend: repoRaw.state_backend ?? globalRaw.state_backend ?? DEFAULT_CONFIG.state_backend
  };

  function origin<T>(
    repoVal: T | undefined,
    globalVal: T | undefined
  ): ConfigOrigin {
    if (repoVal !== undefined) return 'repo';
    if (globalVal !== undefined) return 'global';
    return 'default';
  }

  return {
    config,
    origins: {
      state_backend: origin(repoRaw.state_backend, globalRaw.state_backend),
      autonomous_mode: origin(repoRaw.autonomous_mode, globalRaw.autonomous_mode),
      'watcher.interval_seconds': origin(repoRaw.watcher?.interval_seconds, globalRaw.watcher?.interval_seconds),
      'watcher.trigger_label': origin(repoRaw.watcher?.trigger_label, globalRaw.watcher?.trigger_label)
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/config-load.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all pre-existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/load.ts tests/unit/config-load.test.ts
git commit -m "feat(config): add repo-level config loading and origin tracking"
```

---

## Task 2: Implement `src/config/write.ts`

**Files:**
- Create: `src/config/write.ts`
- Create: `tests/unit/config-write.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/config-write.test.ts`:

```typescript
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initConfigFile, setConfigKey } from '../../src/config/write.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-write-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('initConfigFile', () => {
  it('creates a new file with commented template', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await initConfigFile(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: github-labels');
    expect(content).toContain('autonomous_mode: false');
    expect(content).toContain('interval_seconds: 60');
    expect(content).toContain('trigger_label:');
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'nested', 'dir', 'config.yaml');
    await initConfigFile(filePath);
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('throws when the file already exists', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'state_backend: local\n');
    await expect(initConfigFile(filePath)).rejects.toThrow(/already exists/);
  });
});

describe('setConfigKey — flat keys', () => {
  it('creates the file with the key when it does not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: local');
  });

  it('creates parent directories when the file does not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'sub', 'config.yaml');
    await setConfigKey(filePath, 'autonomous_mode', 'true');
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('replaces an existing flat key in-place', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, '# comment\nstate_backend: github-labels\nautonomous_mode: false\n');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: local');
    expect(content).toContain('# comment');
    expect(content).toContain('autonomous_mode: false');
    expect(content).not.toContain('state_backend: github-labels');
  });

  it('appends a flat key that is absent from the file', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'autonomous_mode: false\n');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('autonomous_mode: false');
    expect(content).toContain('state_backend: local');
  });
});

describe('setConfigKey — nested keys', () => {
  it('replaces an existing nested key within the watcher block', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'watcher:\n  interval_seconds: 60\n  trigger_label: "state:triaged"\n');
    await setConfigKey(filePath, 'watcher.interval_seconds', '120');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('interval_seconds: 120');
    expect(content).toContain('trigger_label:');
  });

  it('appends the full watcher block when watcher block is absent', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'state_backend: local\n');
    await setConfigKey(filePath, 'watcher.interval_seconds', '30');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('watcher:');
    expect(content).toContain('interval_seconds: 30');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/config-write.test.ts
```

Expected: FAIL — `setConfigKey`, `initConfigFile` not found.

- [ ] **Step 3: Implement `src/config/write.ts`**

Create `src/config/write.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_TEMPLATE = `# All fields are optional — defaults are shown below.

# Where workflow state is persisted.
#   github-labels (default) — writes a state:* label to the GitHub issue on
#                             every transition. Requires gh CLI and write access.
#   local — stores state in ~/.freesolo/state/<owner>/<repo>/<issue-number>
state_backend: github-labels

# Autonomous watcher defaults (used by \`freesolo watch\`).
watcher:
  interval_seconds: 60
  trigger_label: "state:triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
`;

export async function initConfigFile(filePath: string): Promise<void> {
  let exists = false;
  try {
    await fs.access(filePath);
    exists = true;
  } catch {
    // ENOENT — file doesn't exist, proceed
  }
  if (exists) throw new Error(`Config file already exists: ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, CONFIG_TEMPLATE, 'utf8');
}

function applyKeyToContent(content: string, key: string, value: string): string {
  const parts = key.split('.');

  if (parts.length === 1) {
    const flatKey = parts[0];
    const pattern = new RegExp(`^${flatKey}:.*$`, 'm');
    const replacement = `${flatKey}: ${value}`;
    if (pattern.test(content)) {
      return content.replace(pattern, replacement);
    }
    const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return `${content}${suffix}${replacement}\n`;
  }

  const [, subKey] = parts;
  const nestedPattern = new RegExp(`^(\\s+)${subKey}:.*$`, 'm');
  const replacement = `  ${subKey}: ${value}`;
  if (nestedPattern.test(content)) {
    return content.replace(nestedPattern, replacement);
  }

  const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${suffix}watcher:\n  ${subKey}: ${value}\n`;
}

export async function setConfigKey(filePath: string, key: string, value: string): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    content = '';
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const updated = applyKeyToContent(content, key, value);
  await fs.writeFile(filePath, updated, 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/config-write.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/write.ts tests/unit/config-write.test.ts
git commit -m "feat(config): add in-place YAML writer and template generator"
```

---

## Task 3: Implement `src/commands/config.ts`

**Files:**
- Create: `src/commands/config.ts`
- Create: `tests/unit/config-command.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/config-command.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { registerConfigCommands, type ConfigCommandDeps } from '../../src/commands/config.js';
import { DEFAULT_CONFIG } from '../../src/config/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: ConfigCommandDeps;
}

function buildHarness(overrides: Partial<ConfigCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: ConfigCommandDeps = {
    loadConfigWithOrigins: vi.fn().mockResolvedValue({
      config: structuredClone(DEFAULT_CONFIG),
      origins: {
        state_backend: 'default',
        autonomous_mode: 'default',
        'watcher.interval_seconds': 'default',
        'watcher.trigger_label': 'default'
      }
    }),
    setConfigKey: vi.fn().mockResolvedValue(undefined),
    initConfigFile: vi.fn().mockResolvedValue(undefined),
    tryResolveRepoRoot: vi.fn().mockResolvedValue('/repo/root'),
    globalConfigPath: () => '/home/user/.freesolo/config.yaml',
    repoConfigPath: (root: string) => `${root}/.freesolo/config.yaml`,
    write: (msg) => io.stdout.push(msg),
    writeError: (msg) => io.stderr.push(msg),
    setExitCode: (code) => { io.exitCode = code; },
    ...overrides
  };
  const program = new Command();
  program.exitOverride();
  registerConfigCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config get', () => {
  it('prints the resolved value for a valid key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'get', 'state_backend'], { from: 'user' });
    expect(io.stdout.join('')).toContain('github-labels');
  });

  it('sets exit code 1 and prints error for unknown key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'get', 'unknown_key'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/unknown key/i);
  });
});

describe('config set', () => {
  it('calls setConfigKey with the global path by default', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'set', 'state_backend', 'local'], { from: 'user' });
    expect(deps.setConfigKey).toHaveBeenCalledWith(
      '/home/user/.freesolo/config.yaml',
      'state_backend',
      'local'
    );
  });

  it('calls setConfigKey with the repo path when --repo is given', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'set', 'state_backend', 'local', '--repo'], { from: 'user' });
    expect(deps.setConfigKey).toHaveBeenCalledWith(
      '/repo/root/.freesolo/config.yaml',
      'state_backend',
      'local'
    );
  });

  it('sets exit code 1 for an invalid value', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'state_backend', 'badvalue'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/invalid value/i);
  });

  it('sets exit code 1 for --repo when not in a git repo', async () => {
    const { program, io } = buildHarness({
      tryResolveRepoRoot: vi.fn().mockResolvedValue(null)
    });
    await program.parseAsync(['config', 'set', 'state_backend', 'local', '--repo'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/not inside a git repo/i);
  });

  it('sets exit code 1 for an unknown key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'bad_key', 'value'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/unknown key/i);
  });
});

describe('config show', () => {
  it('prints all four keys with their origins', async () => {
    const { program, io } = buildHarness({
      loadConfigWithOrigins: vi.fn().mockResolvedValue({
        config: structuredClone(DEFAULT_CONFIG),
        origins: {
          state_backend: 'global',
          autonomous_mode: 'default',
          'watcher.interval_seconds': 'repo',
          'watcher.trigger_label': 'default'
        }
      })
    });
    await program.parseAsync(['config', 'show'], { from: 'user' });
    const out = io.stdout.join('');
    expect(out).toContain('state_backend');
    expect(out).toContain('[global]');
    expect(out).toContain('watcher.interval_seconds');
    expect(out).toContain('[repo]');
    expect(out).toContain('[default]');
  });
});

describe('config init', () => {
  it('calls initConfigFile with the global path by default', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'init'], { from: 'user' });
    expect(deps.initConfigFile).toHaveBeenCalledWith('/home/user/.freesolo/config.yaml');
  });

  it('calls initConfigFile with the repo path when --repo is given', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'init', '--repo'], { from: 'user' });
    expect(deps.initConfigFile).toHaveBeenCalledWith('/repo/root/.freesolo/config.yaml');
  });

  it('sets exit code 1 for --repo when not in a git repo', async () => {
    const { program, io } = buildHarness({
      tryResolveRepoRoot: vi.fn().mockResolvedValue(null)
    });
    await program.parseAsync(['config', 'init', '--repo'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/not inside a git repo/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/config-command.test.ts
```

Expected: FAIL — `registerConfigCommands` not found.

- [ ] **Step 3: Implement `src/commands/config.ts`**

Create `src/commands/config.ts`:

```typescript
import { Command } from 'commander';

import {
  defaultConfigPath,
  loadConfigWithOrigins,
  repoConfigPath as defaultRepoConfigPath,
  type ConfigWithOrigins
} from '../config/load.js';
import { initConfigFile as defaultInitConfigFile, setConfigKey as defaultSetConfigKey } from '../config/write.js';
import { resolveRepoRoot } from '../core/git.js';

export interface ConfigCommandDeps {
  loadConfigWithOrigins: (globalPath?: string, repoRoot?: string) => Promise<ConfigWithOrigins>;
  setConfigKey: (filePath: string, key: string, value: string) => Promise<void>;
  initConfigFile: (filePath: string) => Promise<void>;
  tryResolveRepoRoot: (cwd: string) => Promise<string | null>;
  globalConfigPath: () => string;
  repoConfigPath: (repoRoot: string) => string;
  write: (message: string) => void;
  writeError: (message: string) => void;
  setExitCode: (code: number) => void;
}

async function tryResolveRepoRootDefault(cwd: string): Promise<string | null> {
  try {
    return await resolveRepoRoot(cwd);
  } catch {
    return null;
  }
}

const defaultDeps: ConfigCommandDeps = {
  loadConfigWithOrigins,
  setConfigKey: defaultSetConfigKey,
  initConfigFile: defaultInitConfigFile,
  tryResolveRepoRoot: tryResolveRepoRootDefault,
  globalConfigPath: defaultConfigPath,
  repoConfigPath: defaultRepoConfigPath,
  write: (msg) => process.stdout.write(msg),
  writeError: (msg) => process.stderr.write(msg),
  setExitCode: (code) => { process.exitCode = code; }
};

const VALID_KEYS = [
  'state_backend',
  'autonomous_mode',
  'watcher.interval_seconds',
  'watcher.trigger_label'
] as const;

type ConfigKey = typeof VALID_KEYS[number];

function isValidKey(key: string): key is ConfigKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

function validateValue(key: ConfigKey, value: string): string | null {
  if (key === 'state_backend') {
    if (value !== 'github-labels' && value !== 'local') {
      return `invalid value "${value}" for state_backend — must be "github-labels" or "local"`;
    }
  } else if (key === 'autonomous_mode') {
    if (value !== 'true' && value !== 'false') {
      return `invalid value "${value}" for autonomous_mode — must be "true" or "false"`;
    }
  } else if (key === 'watcher.interval_seconds') {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 5) {
      return `invalid value "${value}" for watcher.interval_seconds — must be an integer >= 5`;
    }
  } else if (key === 'watcher.trigger_label') {
    if (!value.trim()) {
      return `invalid value for watcher.trigger_label — must be non-empty`;
    }
  }
  return null;
}

function getConfigValue(key: ConfigKey, config: ConfigWithOrigins['config']): string {
  if (key === 'state_backend') return config.state_backend;
  if (key === 'autonomous_mode') return String(config.autonomous_mode);
  if (key === 'watcher.interval_seconds') return String(config.watcher.interval_seconds);
  return config.watcher.trigger_label;
}

export function registerConfigCommands(
  program: Command,
  deps: ConfigCommandDeps = defaultDeps
): Command {
  const config = program
    .command('config')
    .description('Read and write freesolo configuration');

  config
    .command('get <key>')
    .description(`Read the resolved value for a key (${VALID_KEYS.join(', ')})`)
    .action(async (key: string) => {
      if (!isValidKey(key)) {
        deps.writeError(`unknown key "${key}" — valid keys: ${VALID_KEYS.join(', ')}\n`);
        deps.setExitCode(1);
        return;
      }
      const repoRoot = await deps.tryResolveRepoRoot(process.cwd()) ?? undefined;
      const result = await deps.loadConfigWithOrigins(deps.globalConfigPath(), repoRoot);
      deps.write(`${getConfigValue(key, result.config)}\n`);
    });

  config
    .command('set <key> <value>')
    .description('Set a config value (default: global config; use --repo for repo config)')
    .option('--repo', 'Write to the repo config (.freesolo/config.yaml)')
    .action(async (key: string, value: string, options: { repo?: boolean }) => {
      if (!isValidKey(key)) {
        deps.writeError(`unknown key "${key}" — valid keys: ${VALID_KEYS.join(', ')}\n`);
        deps.setExitCode(1);
        return;
      }
      const validationError = validateValue(key, value);
      if (validationError) {
        deps.writeError(`${validationError}\n`);
        deps.setExitCode(1);
        return;
      }
      let targetPath: string;
      if (options.repo) {
        const repoRoot = await deps.tryResolveRepoRoot(process.cwd());
        if (!repoRoot) {
          deps.writeError('not inside a git repo — cannot use --repo\n');
          deps.setExitCode(1);
          return;
        }
        targetPath = deps.repoConfigPath(repoRoot);
      } else {
        targetPath = deps.globalConfigPath();
      }
      await deps.setConfigKey(targetPath, key, value);
      deps.write(`set ${key} = ${value} in ${targetPath}\n`);
    });

  config
    .command('show')
    .description('Print all resolved config values with their origin (default, global, repo)')
    .action(async () => {
      const repoRoot = await deps.tryResolveRepoRoot(process.cwd()) ?? undefined;
      const result = await deps.loadConfigWithOrigins(deps.globalConfigPath(), repoRoot);

      const rows: Array<[string, string, string]> = [
        ['state_backend', result.config.state_backend, result.origins.state_backend],
        ['autonomous_mode', String(result.config.autonomous_mode), result.origins.autonomous_mode],
        ['watcher.interval_seconds', String(result.config.watcher.interval_seconds), result.origins['watcher.interval_seconds']],
        ['watcher.trigger_label', result.config.watcher.trigger_label, result.origins['watcher.trigger_label']]
      ];

      const keyWidth = Math.max(...rows.map(([k]) => k.length));
      const valWidth = Math.max(...rows.map(([, v]) => v.length));

      for (const [key, val, orig] of rows) {
        deps.write(`${key.padEnd(keyWidth)}  ${val.padEnd(valWidth)}  [${orig}]\n`);
      }
    });

  config
    .command('init')
    .description('Create a config file with commented defaults (fails if file already exists)')
    .option('--repo', 'Create the repo config (.freesolo/config.yaml) instead of the global config')
    .action(async (options: { repo?: boolean }) => {
      let targetPath: string;
      if (options.repo) {
        const repoRoot = await deps.tryResolveRepoRoot(process.cwd());
        if (!repoRoot) {
          deps.writeError('not inside a git repo — cannot use --repo\n');
          deps.setExitCode(1);
          return;
        }
        targetPath = deps.repoConfigPath(repoRoot);
      } else {
        targetPath = deps.globalConfigPath();
      }
      try {
        await deps.initConfigFile(targetPath);
        deps.write(`Created ${targetPath}\n`);
      } catch (error) {
        deps.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
        deps.setExitCode(1);
      }
    });

  return config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/config-command.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/config.ts tests/unit/config-command.test.ts
git commit -m "feat(config): add config get/set/show/init CLI subcommands"
```

---

## Task 4: Wire `registerConfigCommands` into the CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add import and call in `src/cli.ts`**

Add the import at the top of `src/cli.ts` alongside the other command imports:

```typescript
import { registerConfigCommands } from './commands/config.js';
```

Add the registration call inside `buildCli()`, after the existing `registerReplayCommands` call:

```typescript
  registerConfigCommands(program);
```

- [ ] **Step 2: Verify the command is registered**

```bash
npm run build && node dist/src/bin.js config --help
```

Expected output includes:
```
Usage: freesolo config [command]

Read and write freesolo configuration

Commands:
  get <key>          Read the resolved value for a key
  set <key> <value>  Set a config value
  show               Print all resolved config values with their origin
  init               Create a config file with commented defaults
```

- [ ] **Step 3: Smoke-test `config show` and `config init`**

From within the freesolo repo directory:

```bash
# Show current resolved config (no config files needed)
node dist/src/bin.js config show

# Init the global config (only if it doesn't already exist — skip if it does)
node dist/src/bin.js config init

# Get a single value
node dist/src/bin.js config get state_backend

# Set a value in global config
node dist/src/bin.js config set watcher.interval_seconds 30

# Verify the set took effect
node dist/src/bin.js config get watcher.interval_seconds
# Expected: 30
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(config): wire config command into CLI"
```
