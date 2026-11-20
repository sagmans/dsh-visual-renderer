# Development

## Setup and source authority

Use the Node and package-manager requirements in [package.json](../package.json).
Install dependencies without lifecycle scripts:

```sh
pnpm install --frozen-lockfile --ignore-scripts
scripts/setup-hooks
```

[The installer](../scripts/setup-hooks.mjs) links the hooks into Git's default
hook directory. It does not write Git configuration or replace custom hooks.
If setup reports a conflict, inspect the effective hooks path and existing files.
After moving the checkout, run setup again because links target that checkout.

## Native validation

Run these unchanged gates from the repository root:

```sh
node scripts/check.mjs
node scripts/check.mjs smoke
node scripts/check.mjs staged
node scripts/check.mjs pnpm-floor
markdownlint-cli2 --config .githooks/lib/markdownlint.jsonc AGENTS.md README.md 'docs/*.md'
```

[The native gate](../scripts/check.mjs) owns the exact checks and tool arguments.
It uses Node.js, pnpm, Deno, shfmt, and shellcheck at the versions pinned in
[mise.toml](../mise.toml), failing closed when a required tool is missing or
below its floor. It does not install packages or rewrite source.
Full and smoke modes inspect the working tree and repository hook directories.
Staged mode reads the selected index, not unrelated working-tree changes.
An empty index produces no staged-source coverage.

The gate covers syntax, static lint, format, JSON shape, locale-key parity,
privacy patterns, exports, distribution, dependency bytes, and module registration.
It does not provide semantic JavaScript type checks without runtime declarations.
Module smoke proves registration and the Host export, not browser behavior.

## Local hook gates

Generic checks run before repository-specific checks.
Missing scanners and scanner errors block their applicable gate.
The generic hook library owns tool requirements and scan selection.

- Commit gates scan staged secrets, Markdown, whitespace, and source hygiene.
- The [commit convention](../.githooks/GIT_CONVENTION.md) owns message rules.
  Push gates also require signed commits and DCO.
- Push gates scan the applicable source, dependency, and workflow changes.
  They include Semgrep, Lizard, and OSV Scanner where applicable.
- [The project push wrapper](../.githooks/pre-push.d/20-project) runs native
  validation and
  `pnpm audit --audit-level high --config.offline=false --config.audit=true`
  once per distinct non-deleted pushed tip.
  Missing modules verify the pinned pnpm floor (`pnpm-floor`), then run a
  frozen, offline, script-free install at that tip.
  A cache miss blocks the gate. Existing modules remain intact.

Keep generic entrypoints and `lib/` synchronized from the shared template.
Without authorized upstream access, report required shared changes to the
maintainer rather than editing these copies.
Keep repository-specific checks in the `.d/` wrappers.
Keep all gates active. Do not bypass hooks or relax limits to pass a change.

## Proof by change type

For documentation-only changes, re-read the final text and run the Markdown gate.
Validate relative links, including links to source files.
For comment-only changes, prove executable equivalence with a grammar-aware
comparison. Token equality alone is insufficient when line breaks affect semantics.
Keep temporary proof scripts and receipts outside the repository.

For runtime changes, exercise the installed plugin in a local Web UI.
Cover supported Mermaid and SVG fences plus unsupported or invalid source.
Cover streaming revisions, source toggles, theme and locale changes, windowing,
asset responses, timeout recovery, disablement, and disposal as relevant.
Record the observed results and distinguish them from module smoke.
The repository contains no dedicated unit-test suite.
