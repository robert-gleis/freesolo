# Implementation Review — Issue #18, Round 1

## Status
pass

## Verification commands run
- `npm run build`: PASS — `tsc -p tsconfig.json && node ./scripts/ensure-bin-executable.mjs ./dist/src/bin.js` exits 0. `dist/src/runners/{index,scripted,types}.js` are emitted.
- `npm test`: PASS — 33 test files, **250 tests**, all green. The three new test files contribute 8 (`runner-types.test.ts`) + 16 (`scripted-runner.test.ts`) + 3 (`runner-engine-isolation.test.ts`) = 27 tests, matching the plan's expected count exactly.
- `git diff main..HEAD --stat`: only the 10 expected files changed (spec, plan, two plan-review rounds, three source files, three test files). No incidental modifications.
- `grep -ri tmux src/workflow/`: empty. `grep -r runners src/workflow/`: empty. Engine isolation holds.

## Acceptance criteria
- **Workflow engine is unaware of tmux or any specific runtime** — Met. `src/workflow/` contains no `tmux` identifier and no imports from `src/runners/`. Guarded going forward by `tests/unit/runner-engine-isolation.test.ts`.
- **Interface covers spawn, stop, and log retrieval** — Met. `Runner` in `src/runners/types.ts:37-43` declares `spawn`, `stop`, `logs`, plus `status` and `readonly id`, with the exact signatures from the spec.
- **At least one runner implementation can be slotted in behind the interface** — Met. `ScriptedRunner` in `src/runners/scripted.ts:20` implements `Runner`, is exercised by 16 unit tests covering every documented state transition (`idle → running`, `idle → starting → running`, `idle → starting → error`, `running → stopped`, `starting → stopped` mid-flight, `error → stopped`, `stopped → running` reuse), and is exported from the barrel.
- **Runner identity and lifecycle state are observable** — Met. `id` is a caller-provided readonly property; `status()` returns `{ state, startedAt?, stoppedAt?, exitCode?, error? }`.

## Findings

No findings.

## What looks good

- **Spec contract is exact.** `RunnerState` union order (`idle | starting | running | stopping | stopped | error`), `RunnerStatus` field shape, `SpawnSpec` with optional `env`, `LogSnapshot` with `truncated`, `LogOptions.sinceByteOffset` optional, and the four `RunnerErrorCode` members all match the spec verbatim (`src/runners/types.ts:3-49`). `RunnerError` sets `name = 'RunnerError'` and exposes `code` as `readonly` (`src/runners/types.ts:51-59`).
- **Spawn race guard is correctly implemented.** `src/runners/scripted.ts:65-68` re-checks `this.state === 'starting'` after the `spawnDelayMs` `await`, so a `stop()` that interleaves during the delay is not clobbered by the post-await transition to `running`. The corresponding test (`tests/unit/scripted-runner.test.ts:178-195`) actually exercises this race by issuing `stop()` mid-flight and then awaiting the original spawn promise to confirm state stays `stopped`.
- **`failOnSpawn` correctly throws *after* setting `state = 'error'` and `errorMessage`** (`src/runners/scripted.ts:50-54`). Status reads after the rejection see `state: 'error'` with `error: '<reason>'`, as the spec requires.
- **`stop()` preserves `status.error` from `error → stopped`** (`src/runners/scripted.ts:71-80`): the `stop()` body sets `stoppedAt` and `exitCode` but never clears `errorMessage`, so the documented "cause remains observable on the final `stopped` snapshot" clause is satisfied. The corresponding test (`tests/unit/scripted-runner.test.ts:163-176`) asserts `status.error === 'boom'` after the `error → stopped` transition.
- **`logs()` returns empty snapshot pre-spawn regardless of script content** (`src/runners/scripted.ts:82-85`). The dedicated test on line 20-29 confirms this with a runner constructed with `stdout: 'will not appear yet'`.
- **`combined` log format is exactly per spec.** With both halves: `"[stdout]\n<stdout>\n[stderr]\n<stderr>"` (test asserts `'[stdout]\nhello\n\n[stderr]\noops\n'` for `stdout: 'hello\n', stderr: 'oops\n'` — the trailing `\n` after `hello` is part of the stdout body, then the literal `\n` separator joins to `[stderr]`). With only one half: just that tag + body (`tests/unit/scripted-runner.test.ts:62`). Empty → `''`. `truncated` is always `false`.
- **`status()` returns a fresh object on every call** (`src/runners/scripted.ts:97-103`). Mutating the returned snapshot does not leak — pinned by the test on line 221-230.
- **Engine-isolation regex is well-constructed.** `/(?:from|import)\s*\(?\s*['"][^'"]*\/runners(?:\/[^'"]*)?['"]/` correctly matches `from '../runners/types.js'` and `await import('../runners/index.js')`, while correctly *not* matching `from '../runner.js'` (singular) or `from './runners-helper.js'` (no `/` after `runners`). Optional `\(?` covers the dynamic-import form.
- **Plan execution is disciplined.** Nine commits map one-to-one onto Tasks 1-9 (`git log --oneline` shows: `Add Runner interface and error type` → `Add ScriptedRunner skeleton` → `Implement ScriptedRunner.spawn happy path and invalid-state guard` → `Make ScriptedRunner.spawn honour spawnDelayMs` → `Support failOnSpawn in ScriptedRunner` → `Implement ScriptedRunner.stop including no-op and error-to-stopped paths` → `Pin ScriptedRunner reuse-after-stop and status snapshot freshness with tests` → `Expose Runner public surface via src/runners barrel re-export` → `Add regression test guarding workflow engine isolation from runners`). Task 7 is correctly test-only (no source file in the staged diff).
- **Barrel surface matches the plan.** `src/runners/index.ts` re-exports the documented types (`LogOptions`, `LogSnapshot`, `Runner`, `RunnerErrorCode`, `RunnerId`, `RunnerState`, `RunnerStatus`, `SpawnSpec`) with `export type`, runtime-exports `RunnerError` and `ScriptedRunner` as values, plus `ScriptedRunnerScript` as a type. No accidental leaks.
- **Convention adherence.** Tests use the existing `describe / it` style; all files live flat under `tests/unit/`; imports use `.js` extensions per NodeNext convention; no new dependencies added to `package.json`; `src/runners/` mirrors the layout of `src/agents/`.
- **The "error → stop → spawn" path the user flagged as a possible coverage gap is in fact covered transitively**: the "reuse after stop with a fresh `startedAt`" test (line 199-219) traverses `idle → running → stopped → running`, and the `error → stopped` test (line 163-176) ends in a `stopped` state from which `spawn()` is permitted by the same precondition check. The combination is structural — if either path worked alone (both pinned by tests), the composition is forced by the implementation's single precondition check. Worth noting but not worth adding a test for.

STATUS=pass
