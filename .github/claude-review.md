# Cloud code review brief

What this repository is, and what to watch for in it. Everything else — what PR
context is available, how to post a review, what makes a finding worth raising,
comment hygiene, PR-description shape, the versioning mechanism — comes from the
review workflow's runtime notes. Don't restate it here: this file is read first,
so a stale copy would silently override the current text.

Not loaded by local Claude Code; only the cloud reviewer reads this.

## What this repo is

`ghul-vsce` is the ghūl VS Code extension, published to the marketplace, plus the
standalone `ghul-language-server` package built from the same tree. It speaks the
compiler's analysis-mode protocol over the spawned process's stdio pipes, so it is
coupled to `ghul.compiler`:
a protocol change lands here and there together.

TypeScript. The server half has no dependency on the `vscode` API, which is what
makes the standalone package possible - keep it that way.

## What to watch for here

- Anything pulling a `vscode` API import into the server half. That silently breaks
  the standalone `ghul-language-server` package, which CI does not catch.
- Analysis-mode protocol changes that assume a compiler version users may not have.
  The extension has to degrade rather than fail against an older analyser.
- Activation and initialisation ordering. Tool restore must precede anything that
  shells out to the compiler; a regression here surfaces as a phantom error on a
  clean project.
- Unhandled promise rejections and swallowed errors on the language-server message
  path - they present to users as the extension silently going dead.

## Versioning

This section is the only authority on what breaking means here — the runtime notes
defer to it — so it covers the whole user-visible surface, not just the protocol.
That surface is: the analysis-mode protocol the extension shares with
`ghul.compiler`; the commands, settings and keybindings the extension contributes;
and the `ghul-language-server` package's own interface.

Major means breaking any of those: a removed or incompatible protocol message, a
removed or renamed command or setting, or a change requiring a compiler version
users do not yet have. Minor means additions — new commands, new settings, new
protocol messages the compiler can ignore.
