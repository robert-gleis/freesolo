# Config Management — Design Spec

**Date**: 2026-06-08  
**Status**: approved

## Overview

Add two complementary capabilities to FreeSolo:

1. **Repo-Level Config** — `.freesolo/config.yaml` in the repo root that overrides the global config on a per-field basis.
2. **`freesolo config` CLI** — subcommands to read, write, show, and initialise config files without manually editing YAML.

## Config Resolution Order

```
DEFAULT_CONFIG  →  global (~/.freesolo/config.yaml)  →  repo (.freesolo/config.yaml)
```

Repo values have highest precedence. Missing fields fall back to global, then to defaults. Validation runs on the fully-merged result.

## File Locations

| Scope  | Path |
|--------|------|
| Global | `~/.freesolo/config.yaml` (existing, via `FREESOLO_CONFIG` env override) |
| Repo   | `<repo-root>/.freesolo/config.yaml` (new) |

## Config Fields

| Key | Type | Valid Values | Default |
|-----|------|-------------|---------|
| `state_backend` | string | `github-labels`, `local` | `github-labels` |
| `autonomous_mode` | boolean | `true`, `false` | `false` |
| `watcher.interval_seconds` | integer | ≥ 5 | `60` |
| `watcher.trigger_label` | string | non-empty | `state:triaged` |

## CLI Commands

```bash
# Read resolved (merged) value
freesolo config get <key>

# Write to global (default) or repo config
freesolo config set <key> <value>
freesolo config set <key> <value> --repo

# Show all resolved values with origin annotation
freesolo config show

# Create config file with commented defaults (fails if file already exists)
freesolo config init          # → ~/.freesolo/config.yaml
freesolo config init --repo   # → <repo-root>/.freesolo/config.yaml
```

### `config show` output format

```
state_backend:            local           [repo]
autonomous_mode:          false           [global]
watcher.interval_seconds: 60              [default]
watcher.trigger_label:    state:triaged   [global]
```

### `config set` validation

Values are validated immediately on write. Invalid values are rejected with a clear error message before the file is touched.

## Architecture

### Changed Files

**`src/config/load.ts`**

`loadConfig` gains an optional `repoRoot` parameter:

```ts
loadConfig(globalPath?: string, repoRoot?: string): Promise<FreesoloConfig>
```

When `repoRoot` is provided, `loadConfig` additionally reads `<repoRoot>/.freesolo/config.yaml` and merges it (repo wins per-field). All existing callers pass no `repoRoot` and continue to behave unchanged.

A new helper is exported:

```ts
repoConfigPath(repoRoot: string): string
// returns: path.join(repoRoot, '.freesolo', 'config.yaml')
```

### New File: `src/config/write.ts`

Two exported functions:

**`setConfigKey(filePath: string, key: string, value: string): Promise<void>`**

- File does not exist → creates it (including parent directory) and writes just the key.
- Key already present in file → in-place regex replacement; existing comments are preserved.
- Key absent from file → appended to end of file.

Key patterns:
- Flat keys (`state_backend`, `autonomous_mode`): `/^key:\s*.+/m`
- Nested keys (`watcher.interval_seconds`, `watcher.trigger_label`): `/^\s+sub_key:\s*.+/m` — safe because these sub-keys only appear inside the `watcher:` block. If the `watcher:` block is absent, the full block is appended.

**`initConfigFile(filePath: string): Promise<void>`**

Writes the full commented template (all fields with their defaults and explanatory comments, matching the README). Throws if the file already exists.

### New File: `src/commands/config.ts`

Registers the `config` command with four subcommands: `get`, `set`, `show`, `init`.

- `get` and `show` auto-detect the repo root from `process.cwd()` via the existing `resolveRepoRoot()` helper; falls back gracefully when not in a git repo (repo-level config is simply skipped).
- `set` determines the target file: global path by default, repo path with `--repo`. Creates the parent directory if needed.
- `set --repo` and `init --repo` require being inside a git repo; they exit with a clear error if no repo root can be detected.
- `init` likewise targets global or repo based on `--repo` flag. Exits with a clear error if the file already exists.

**`src/cli.ts`** — adds `registerConfigCommands(program)`.

## Non-Goals

- No support for environment-variable-per-key overrides (the existing `FREESOLO_CONFIG` path override is sufficient).
- No interactive `config edit` that opens an editor — users can edit the YAML directly.
- No migration of existing callers to pass `repoRoot`; that is opt-in per caller.

## Template Written by `config init`

```yaml
# All fields are optional — defaults are shown below.

# Where workflow state is persisted.
#   github-labels (default) — writes a state:* label to the GitHub issue on
#                             every transition. Requires gh CLI and write access.
#   local — stores state in ~/.freesolo/state/<owner>/<repo>/<issue-number>
state_backend: github-labels

# Autonomous watcher defaults (used by `freesolo watch`).
watcher:
  interval_seconds: 60
  trigger_label: "state:triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
```
