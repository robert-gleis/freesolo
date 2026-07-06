# Plan Review Round 4 — Issue #20

## Status
pass_with_findings

## Summary
The plan is implementation-ready in its broad strokes — scope is correctly limited to the verification pipeline, types and signatures are consistent across tasks, fixtures match production shapes, the SIGINT/abort contract is well thought out, and the codebase-fit (DI mirroring `start.ts`, ESM `.js` imports, zod 4, execa 9, vitest layout) all checks out. Two small but real defects remain: the per-check exception path can interleave writes between two distinct file descriptors on the same log path, and the runner-test `now()` fixture is one tick away from producing malformed ISO strings. Both are easy fixes worth doing before coding begins.

## Findings

### 1. Per-check `catch` may race against the open log handle on the same path
- **Affected:** Task 4, `src/verification/runner.ts`, the per-check `try { … } catch (error) { … } finally { handle.close() }` block (lines ~1296–1327 of the plan).
- **What's wrong:** If `deps.execCheck` throws after emitting some chunks via `onChunk` but before returning, the per-check `catch` writes `[stderr] ${message}\n` via `fs.writeFile(logPath, …, { flag: 'a' })`. At that moment `handle` is still open (it isn't closed until the `finally`), and `writeQueue` may still hold un-awaited writes from the chunks that arrived before the throw. Two distinct file descriptors are now appending to the same path with no ordering guarantee — the synthetic error line can interleave with, or be overwritten by, the pre-throw chunks. The current "execCheck throws synchronously, no chunks emitted" test is the only path that does not trip this, so the bug is invisible to the suite as written.
- **Why it matters:** The plan markets the per-check `catch` as the guarantee that partial runs are inspectable. Right now that guarantee is order-dependent on a race between two fds.
- **Suggested fix:** In the per-check `catch`, write the synthetic error line through the *open* `handle` (after `await writeQueue`, then `await handle.write('[stderr] ' + message + '\n')`) instead of via `fs.writeFile` on the path. Or close the handle before the synthetic write. Either way, restrict appends to a single fd. Adding a runner test that emits one chunk and then throws would lock the behaviour.

### 2. Runner test's `now()` fixture overflows after 10 calls and produces invalid ISO strings
- **Affected:** Task 4, `tests/unit/verification-runner.test.ts`, `buildDeps`:
  ```ts
  now: () => new Date(`2026-06-01T10:00:0${tick++}.000Z`)
  ```
- **What's wrong:** Once `tick` hits 10 the template becomes `2026-06-01T10:00:010.000Z`, which `new Date(...)` parses as `Invalid Date`, and `.toISOString()` on that throws `RangeError`. For the 3-check no-bail test the runner makes exactly 9 `deps.now()` calls (1 run start + 2 per check × 3 + 1 finally-write + 1 final return = 9), landing on tick 8 — one tick of headroom. Any new `now()` call in the runner (e.g. a future log header, a small refactor) or any test that adds a fourth check immediately breaks the suite for a reason that is very hard to spot.
- **Why it matters:** Trivially-passing today, but a tripwire for the next change. The fragility is also confusing to debug — a `RangeError` deep in the runner does not point at the fixture.
- **Suggested fix:** Use a monotonic base + offset, e.g. `now: () => new Date(baseMs + tick++ * 1000)` (with `const baseMs = Date.parse('2026-06-01T10:00:00.000Z')`). Same monotonic property, no string-parsing pitfall.

### 3. `NEVER_ABORT` is a module-singleton that accumulates listeners across pipeline runs
- **Affected:** Task 4, `src/verification/runner.ts`, `const NEVER_ABORT = new AbortController().signal` and the `defaultRunPipelineDeps.execCheck` add/remove dance.
- **What's wrong:** Within a single pipeline run, checks run sequentially, so only one `onAbort` listener exists at a time and the `removeEventListener` in `finally` cleans up. Across the *process lifetime*, however, every invocation of `runVerificationPipeline` with no `abortSignal` (e.g. the integration test, future programmatic callers, the upcoming Verification Gate consumer) adds and removes listeners on the same shared signal. The remove happens, so this isn't a leak — but the `MaxListenersExceededWarning` heuristic on `AbortSignal` (Node uses `events.setMaxListeners` defaulting to 10) can produce noisy warnings if anything ever overlaps these runs, and reusing a "never-fires" controller for the purpose of avoiding the optional-check makes the abort path harder to read.
- **Why it matters:** Not a correctness bug today, but it couples unrelated runs and obscures the abort contract. Future readers will spend cycles wondering whether `NEVER_ABORT` is actually shared state.
- **Suggested fix:** Make `abortSignal` strictly optional inside `defaultRunPipelineDeps.execCheck` (check `if (input.abortSignal)` before any add/remove), or instantiate a fresh `new AbortController().signal` per call. Either keeps the contract clear and removes the singleton.

## Notes
- The runner's "preserves log line order under many concurrent chunks" and "does not mangle prefixes when chunks arrive mid-line" tests are exactly the right level of paranoia for the chunked-stream logic and walk through cleanly against the implementation.
- The split between `runner.ts` owning `run.json` persistence and the no-op of `store.ts::writeRun` (kept for symmetry) is a sensible response to round-3 feedback. Worth a one-line JSDoc on `writeRun` explaining it is intentionally not called by the pipeline so future readers don't try to "wire it up."
- The integration test's `process.stdout.write("...", () => process.exit(N))` pattern for the failing check is robust against the stdout-drain race that plain `console.log + process.exit` can hit. Good catch.
- `--issue abc` flows through `parseInt → NaN → IssueIdError` per the resolver's `Number.isInteger` guard; behaviour is correct but exits with code 2 and a slightly cryptic message. Not blocking — just worth a friendlier error string if you have time during implementation.
- Spec coverage is complete: acceptance criteria (configurable, structured pass/fail + logs, deterministic, persisted by issue id), all four CLI flags, exit codes 0/1/2/130, and the persistence path are all mapped to specific tasks/tests.
