# Plan Review — Issue #17 — Round 4

**Status:** pass

## Summary
The three round-3 findings are addressed cleanly. `defaultRunner` now discriminates spawn failures from non-zero exits via `exitCode === undefined` (round-3 Finding 1's suggested Option b), the non-zero-exit test fixture now carries `failed: true` and `shortMessage` (round-3 Finding 2), and the README append block now uses an outer tilde fence so the nested triple-backticks render unambiguously (round-3 Finding 3). I went through the rest of the plan independently and found no new blockers, majors, or minors that warrant rework. The transition table, error message format, exit codes, CLI surface, dependency injection seams, and `RepoRef` re-export still align with the spec at `docs/freesolo/specs/2026-06-01-workflow-state-machine-design.md`.

## Round 3 follow-up
- Finding 1 (`defaultRunner` ENOENT detector matched wrong execa-9 shape) — **fixed correctly.** Plan lines 481-506 drop the brittle `error.code === 'ENOENT'` sniff in favour of `if (execaError?.exitCode === undefined)`. This is robust across execa upgrades and reachable in production. The matching test at plan lines 408-414 fabricates a plain `Error` with no `exitCode`, which is the minimal shape the production code reads. Verified the production catch block under real execa 9 semantics (rejections from missing binaries surface without an `exitCode`; rejections from non-zero exits surface with one) — both paths exercised.
- Finding 2 (non-zero-exit test fixture too thin) — **fixed correctly.** Plan lines 418-426 now assign `failed: true` and `shortMessage: 'Command failed with exit code 1: gh issue view 1'` onto the mock rejection in addition to `exitCode/stdout/stderr`, so the fixture mirrors an `ExecaError` shape closely enough that incidental property reads added later will fail fast.
- Finding 3 (nested triple-backtick README fence) — **fixed correctly.** Plan lines 1209-1225 wrap the README snippet in `~~~markdown` / `~~~` tilde fences and explicitly tell the implementer "the tildes themselves are NOT part of what you paste; only the content between them is." The instruction now anchors the insert point to "immediately after the existing `## Usage` code block… and before the `## Worktree setup hooks` heading" — both anchors verified to exist in `README.md` at lines 46-56.

## Findings
No new findings.

## Verified OK
- Transition table at plan lines 184-192 matches spec table at spec lines 40-50 exactly, including `closed: []` as terminal.
- `InvalidTransitionError` message format at plan line 202 (`Invalid workflow transition: ${from} → ${to}. Allowed from ${from}: ${allowed}.`) matches spec line 83 verbatim, with `(terminal)` fallback when `allowedNext` is empty. Both the normal and terminal-state variants are asserted in `state-machine.test.ts`.
- Self-transition handling consistent across layers: `canTransition(s, s) === true`; `assertTransition(s, s)` is `void`; `writeState` short-circuits before any `gh` call (plan lines 611-613) — the self-transition test at plan lines 351-357 asserts zero `gh` invocations.
- `gh label create … --force` is called unconditionally before every label swap (plan lines 618-620), the round-1 brittle error-string sniff is gone, and the unit test at plan lines 359-388 asserts both calls happen in `label create` → `issue edit` order with the correct flags.
- `RepoRef = Pick<RepoContext, 'owner' | 'repo'>` is appended to `src/core/types.ts` (plan line 447), re-exported from `src/workflow/state-store.ts` (plan line 460), and imported via the re-export in `src/commands/state.ts` (plan lines 928-930) — single canonical type, no drift. Note: `RepoContext` is defined at `/Users/A15AB98/projects/private/freesolo.issue-17-introduce-workflow-state-machine/src/core/types.ts:14-20`, so `Pick<RepoContext, 'owner' | 'repo'>` resolves to `{ owner: string; repo: string }` as required.
- `parseGitHubRemote` returns `RepoContext | null` (see `src/core/git.ts:5-29`), and the plan's `defaultResolveRepoRef` at lines 948-956 correctly handles the null branch and projects out `owner`/`repo` — typing is sound.
- `vi.mock('execa', () => ({ execa: vi.fn() }))` at plan line 267, plus `beforeEach(() => { vi.mocked(execa).mockReset(); })` at plan lines 270-272, mirror the `tests/unit/github.test.ts:3-15` pattern exactly. No mock-leak maintenance trap.
- Exit-code mapping (1/2/3/4) fully covered: invalid transition / generic (`state-command.test.ts` plan lines 858-880 and 838-855), null state on `get` (plan lines 746-755), missing `FREESOLO_ENGINE` on `transition` (plan lines 771-789), `MultipleStateLabelsError` on both `get` (plan lines 757-767) and `transition` (plan lines 882-902).
- `state get` is exercised both with and without `FREESOLO_ENGINE` (plan lines 721-744), locking in the spec's "always allowed" requirement (spec line 99).
- `parseIssueNumber` at plan lines 975-981 rejects `0`, negatives, non-integers, and trailing whitespace via `String(parsed) !== value.trim()`, with a clear `InvalidArgumentError` from Commander.
- `isKnownWorkflowState` at plan lines 983-985 narrows `--to` to `WorkflowState` before the typed call to `writeState`, so the `target: WorkflowState` assignment is sound and unknown values are caught with exit code 1 + "Unknown state" message.
- `withCommanderErrorHandling` correctly re-throws `CommanderError` (preserving `exitOverride` semantics for argument-parsing failures) and maps `MultipleStateLabelsError` to exit code 4 while defaulting to 1 for other errors.
- `defaultRunner`'s spawn-failure branch surfaces the same friendly message style as `src/core/github.ts:184-186` (`'freesolo requires GitHub CLI access. Run \`gh auth status\` and retry.'`), giving UX parity with `listAssignedIssues`.
- CLI registration test at plan lines 1122-1129 uses `program.commands.find((command) => command.name() === 'state')` — same shape as the existing `cli.test.ts` start-command check.
- `src/cli.ts` replacement at plan lines 1142-1178 is a precise superset of the current file (`/Users/A15AB98/projects/private/freesolo.issue-17-introduce-workflow-state-machine/src/cli.ts:1-33`), adding only the import and `registerStateCommands(program)` call.
- Verification Pass section (plan lines 1236-1242) sticks to `npm test` and `npm run build` only — no flaky live-`gh` smoke step.
- Spec acceptance criteria (spec lines 133-139) all mapped: labels under `state:` prefix; `TRANSITIONS` is a single const enumerated by tests; `FREESOLO_ENGINE` gate with exit code 3; `InvalidTransitionError` with spec-mandated message; stateless recovery via `readState`.

---

**Final:** pass (0 blockers, 0 majors, 0 minors)
