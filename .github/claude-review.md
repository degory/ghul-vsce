# Cloud code review brief

Instructions for the Anthropic Claude Code Action invoked from the `code_review` job in `.github/workflows/CICD.yaml`. Not loaded by local Claude Code; only the cloud reviewer reads this.

## How to operate

- The PR branch is checked out in the working directory.
- Get the diff via `gh pr diff <N>`, the body via `gh pr view <N> --json title,body`.
- Read the changed source files in full when context matters — the diff alone often hides whether a contract is upheld.
- Post findings only to GitHub. Anything you say in chat is invisible.

## What to post, where

- **Inline comments** for specific code findings: `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`. One finding per comment; don't pile multiple unrelated concerns into one.
- **End every review with one `gh pr review` verdict.** Pick exactly one:
  - `gh pr review <N> --approve --body "<one-sentence summary>"` — no findings worth raising. Approval is the merge signal: auto-merge is usually on, and even when it isn't, an approved PR is one button-click from landing. Do not approve while raising reservations of any kind.
  - `gh pr review <N> --request-changes --body "<one-paragraph summary of the theme>"` — at least one finding should hold up the merge. Use this whenever you've posted an inline comment the author should act on before this PR ships.
- **The approve body is a brief positive summary, nothing more.** One sentence describing what the PR does ("Wire `restoreDotNetTools` into activation ordering", "Bump TypeScript and re-run prettier"). It is not a place to add caveats, "BTW", "minor nit", or "consider…" observations alongside the approval. If you find yourself wanting to add a qualification or addendum, that qualification *is* a finding — drop the approval, raise it as an inline comment, and switch the verdict to `--request-changes`.
- **There is no "non-blocking" verdict.** If a finding is worth saying out loud, it's worth blocking on — raise it and request changes. If it isn't worth blocking, stay silent. Closing notes like "neither blocks merge", "non-blocking, but…", "minor nit…", "consider…" are incoherent with the workflow: by the time the author reads them, the PR is approved and about to merge. Don't write them.
- Don't post a separate top-level `gh pr comment` — put the summary in the review body instead.

## What CI has already proven

You're invoked only after the CI workflow passes (TypeScript compiles, unit tests pass, the beta `.vsix` package builds). **Don't second-guess validity.** Don't ask "does this compile?", "does this build a package?" CI just answered both. Spend your attention on what the test suite can't catch.

## What this repo is

`ghul-vsce` is the VS Code extension for the ghūl language — the marketplace-published client (`degory/ghul-language` extension). It talks to a project-pinned compiler (resolved via the host project's `.config/dotnet-tools.json`) over the analysis-mode protocol, exposing diagnostics, hover, completion, signature help, rename, and references in the IDE.

Two-package layout (`client/` and `server/`) under one TypeScript root. `client/` is the VS Code extension proper; `server/` is the language-server-protocol bridge that spawns the compiler in `--analyse` mode and translates JSON analyser messages into LSP traffic.

Cross-repo coupling: the VSCE consumes the compiler's analysis-mode protocol — a breaking compiler protocol change requires a coordinated VSCE major bump that raises `minCompilerVersion`. See "Versioning" below.

## Severity bar

Flag:

- Bugs and likely-bugs (TypeScript correctness errors `tsc` can miss — wrong type assertions, runtime narrowing that contradicts the type, swallowed promises).
- **Breaking changes to user-visible UX.** Removed/renamed commands, settings, status-bar items; changed default behaviour of an existing setting; changed activation triggers in a way users would notice. Anything that would surprise an existing user updating from the marketplace.
- **Analysis-mode protocol coordination.** Any change in `server/` that adapts to a compiler protocol change without a coordinated `degory/ghul` PR in flight (or vice versa). The two repos must ship together for breaking protocol changes.
- **`minCompilerVersion` discipline.** A PR that requires a newer compiler must raise `minCompilerVersion` in `package.json` so the activation check surfaces the mismatch up-front rather than failing opaquely at first analyse call.
- **Activation ordering.** `client/src/extension.ts` `activate()` and `restoreDotNetTools` / `generateAssembliesJson` ordering — gets this wrong and fresh checkouts hit spurious analyser errors. See the `claude/fix-analyser-spurious-errors` work for the fix shape.
- Deprecated NPM dependencies or transitive vulnerabilities that the change introduces or exacerbates.
- Source comment hygiene violations (see below).
- PR description violations (see below).
- Wrong `VERSION` bump — see "Versioning" below. Both directions: a breaking change going out under the default patch, and a `VERSION` raise that the change doesn't merit.

Don't flag:

- Hypothetical concerns ("could this race…?" without a concrete path).
- "Consider…" suggestions that don't identify a real defect.
- Anything you're not confident about.
- Pure formatting drift from `prettier` — `prettier` is the source of truth; if it didn't object, neither should you.

Silence on a low-confidence finding is better than noise. The reviewer's job is high-signal feedback, not exhaustive enumeration.

A workflow-only or docs-only PR doesn't need code-review scrutiny — skim the PR description and the diff; if there's nothing actionable, approve with a one-line summary.

## Source comment hygiene

Default position: no comment.

Only comment where a competent informed reader would need extra context — a non-obvious invariant, a subtle ordering requirement, a workaround whose reason isn't visible from the code.

Flag comments that:

- Are excessively long. Brevity beats completeness.
- Read as justification ("this is important because…", "this matters because…"). Either the code stands on its own merit, or it shouldn't be there.
- Reference documents that aren't in the repo, internal labels ("phase 1", "option B"), or issues/PRs/"the fix"/"what changed".
- Read as one half of a conversation.

## PR description

PR description becomes the squash-commit message and the changelog entry. It ships permanently.

- **Plain language.** No marketing tone, no defensive prose, no self-justification.
- **Brevity.** A focused fix is often a single bullet.
- **No `## Summary` / `## Test plan` / `## Testing` headings.** The PR description IS the summary.
- **No private or ephemeral references.** Memory files, hoisted `docs/claude/`, internal workplans, Claude/codex task URLs, Slack threads — none of it should appear. Public sibling-repo references (`degory/ghul#NNNN`, etc.) are fine when they convey a real cross-repo dependency.
- **No internal labels** ("Phase 2 of…", "predecessor branch", "stage 1", "option B").
- **No local test results** ("all tests pass locally", "vsce package clean", etc.). CI is the proof.
- **No `Co-authored-by:` trailer in the body.** Squash-merge appends a deduped block automatically.

Body is `-`-bullets under one or more of:

- `Enhancements:` — only for things end users of the extension would notice (new commands, settings, UI surface).
- `Bugs fixed:` — describe what was *broken*. Reuse the issue's exact title with `(closes #NNNN)` if there's an issue.
- `Technical:` — internal changes. If the change reads as needing justification, ask whether it's really needed.

At least one section; any can be omitted.

## Versioning

`ghul-vsce` is on v0.x in the VS Code marketplace. Strict semver throughout. Bump table:

- **Major (X.0.0).** Minimum supported compiler version moves up (i.e. the VSCE's `minCompilerVersion` rises and the activation check rejects older compilers). Breaking change to user-visible UX — removed/renamed commands, settings, status items, or any behaviour change a user updating from the marketplace would notice. Coordinated with a `degory/ghul` analysis-mode protocol major.
- **Minor (X.Y.0).** New features that gracefully no-op on older compilers, new settings, new commands. Additive only.
- **Patch (X.Y.Z).** Bug fixes. Dependency updates. Internal refactors, tests, CI.

Mechanism: default is patch. A non-patch release is cut by **raising the `VERSION` file** in the PR (code-owned via `.github/CODEOWNERS` — requires the code owner's approval). `#minor`/`#major` markers in the PR body are no-ops; don't add them. A `workflow_dispatch` `version` input overrides outright (emergencies only).

Flag when:

- The PR raises `minCompilerVersion`, removes/renames a command or setting, or otherwise breaks UX without raising `VERSION` to a major.
- The PR adds a new command, setting, or feature without raising `VERSION` to a minor.
- The PR raises `VERSION` but the change doesn't merit the bump.
- The PR adapts `server/` to a `degory/ghul` analysis-mode protocol change but no coordinated compiler PR is in flight, or the compiler ships a protocol break without a matching VSCE PR.

(Canonical reference: `docs/claude/versioning.md` in the workspace — referenced for context only; not present in this repo.)

## Posting mechanics — reminder

- Inline: `mcp__github_inline_comment__create_inline_comment` with `confirmed: true`.
- Verdict (exactly one, always): `gh pr review <N> --approve|--request-changes --body "..."`. Approve only when you've raised nothing the author should act on; otherwise request changes.
- Chat output is invisible. If you didn't post it to GitHub, it didn't happen.
