# Repository guide

Transcript Visuals enhances Mermaid and SVG fences in session transcripts.
The Host serves one package asset. The browser owns the transcript enhancement.

## Invariants

- Keep the Host and browser entries separate: [index.js](index.js) and
  [client.js](client.js).
- Preserve the shell's source nodes. Add only owned figures and visibility
  classes so React reconciliation and transcript windowing retain their nodes.
- Treat both authored SVG and Mermaid output as untrusted at page insertion.
  Keep the opaque Mermaid realm and the parent sanitizer as separate boundaries.
- Keep counters, styles, observers, timers, and the realm within their instance
  lifetime. Disposal must restore the shell source.
- Keep exports, the bundle patch, and locale metadata aligned through
  [package.json](package.json). Runtime toolbar dictionaries live in the client.

## Read for the change

- Before changing detection, rendering, lifecycle, themes, or locales, read
  [Architecture](docs/ARCHITECTURE.md).
- Before setup, validation, hook maintenance, or browser proof, read
  [Development](docs/DEVELOPMENT.md).
- Before changing assets, SVG/CSS policy, directives, dependencies, privacy, or
  distribution, read [Security](docs/SECURITY.md).
- For installation, supported fences, controls, and user limits, read
  [README](README.md).

Keep dependency pins, source limits, and check commands in their owning source.
Keep shared hook entrypoints and libraries synchronized from their template.
Repository-specific gates belong in the hook `.d/` directories.
