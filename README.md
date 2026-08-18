# ghūl programming language Visual Studio Code extension

[![CI/CD](https://img.shields.io/github/actions/workflow/status/degory/ghul-vsce/CICD.yaml?branch=main)](https://github.com/degory/ghul-vsce/actions/workflows/CICD.yaml?query=branch%3Amain)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/degory.ghul)](https://marketplace.visualstudio.com/items?itemName=degory.ghul)
[![Release](https://img.shields.io/github/v/release/degory/ghul-vsce?label=release)](https://github.com/degory/ghul-vsce/releases)
[![Release Date](https://img.shields.io/github/release-date/degory/ghul-vsce)](https://github.com/degory/ghul-vsce/releases)
[![Issues](https://img.shields.io/github/issues/degory/ghul-vsce)](https://github.com/degory/ghul-vsce/issues)
[![License](https://img.shields.io/github/license/degory/ghul-vsce)](https://github.com/degory/ghul-vsce/blob/main/LICENSE)
[![ghūl](https://img.shields.io/badge/gh%C5%ABl-100%25!-information)](https://ghul.dev)

This Visual Studio Code extension provides support for the [ghūl programming language](https://www.ghul.dev/), including:
- syntax highlighting
- error highlighting as you type
- code snippets
- symbol information on hover
- code completion
- function signature help
- go to/peek definition
- go to/peek references
- go to/peek implementations
- go to symbol in file
- go to symbol in workspace
- rename symbol

## Settings

How the extension behaves is configured through ordinary editor settings, so
they appear in the Settings UI and can be set per user, per workspace, or per
workspace folder:

- `ghul.incrementalAnalysis` — reuse the analyser's existing state across an
  edit instead of rebuilding the whole project for each one. Much faster on a
  large project, at the cost of some answers being briefly out of date after an
  edit that changes a declaration. Off unless turned on.
- `ghul.plaintextHover` — render hovers as plain text rather than markdown.

How the *project* is built stays in the project file: `<GhulCompiler>`,
`<GhulSources>` and `<GhulOptions>` in the `.ghulproj` govern an ordinary
build. Diagnostics options (`<GhulOptions>`, `<GhulUnderscoreAccess>` and
friends) reach the extension the same way, but not by re-reading the XML: on
a ghul.runtime 14.1.0+ project, the extension asks MSBuild to resolve them
first and reads the answer from `.ghul-options.json`, so it sees what the
build actually resolved rather than a guess at it - conditions applied,
properties evaluated. A project on an older `ghul.runtime` pin falls back to
a direct (best-effort) reading of the unconditioned `<GhulOptions>` entries.

A `ghul.json` in the workspace root is still read, and still sets
`incremental_analysis` and `want_plaintext_hover` for a project that already
does. An editor setting wins over it wherever the user has expressed a
preference.

## Other editors

The language server this extension runs is also published on its own, for any
editor that speaks LSP, as the `@ghul/language-server` npm package and as a
tarball attached to each [release](https://github.com/degory/ghul-vsce/releases).
See [language-server/README.md](language-server/README.md) for setup.


