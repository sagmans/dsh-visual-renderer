# Transcript Visuals

Render diagrams as graphics inside DeepSeek Harness session transcripts. Instead
of a wall of diagram source, the transcript shows the drawing; the source stays
one click away.

## Rendered fences

| Fence language   | Result                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mermaid`, `mmd` | Mermaid diagram: flow, sequence, class, state, ER, gantt, timeline, mindmap, quadrant, XY chart, radar, treemap, architecture, packet, block, sankey, C4, and the other Mermaid diagram types |
| `svg`            | Inline SVG graphic at its authored size                                                                                                                                                       |

Other languages keep the normal code block. Use the **Show source** control in a
drawing's toolbar to switch back to the fence, and **Show diagram** to return.

## Behavior

- Drawings render when they scroll near the viewport, so long transcripts stay
  fast. A drawing is re-read and re-rendered when its fence source changes.
- Streaming keeps a complete drawing stable: while the model is still writing
  the fence, an intermediate invalid revision does not flash the source. A fence
  that is still invalid after the stream settles falls back to source.
- Host theme colors and both light and dark appearance are followed through the
  shell's `theme/change` event; a theme switch re-renders the drawings.
- Switching the interface language relabels the drawing toolbar.

## Fence detection

The shell gives these fences no language token: languages it does not
syntax-highlight render a localized label instead of the fence word. Detection
therefore reads the source. A `mermaid` fence matches when its first directive
line is a Mermaid keyword (after YAML frontmatter, `%%` comments and blank
lines, so configured diagrams still match); an `svg` fence matches when its root
element is `<svg>`. A bare banner token is a real fence language: if it names no
renderer, the block stays source rather than being guessed from its content.

## Security

Diagram source is model output, so it is untrusted input:

- Mermaid runs in strict security mode inside an opaque sandboxed iframe. A
  deny-by-default content policy blocks image, font, connection, and
  nested-frame loads. Only the fixed package script and trusted bootstrap carry
  script nonces. Diagram source travels through bounded messages, never through
  frame HTML.
- The parent accepts replies only from its frame and private channel. Timeouts
  destroy the rendering realm. Returned SVG still passes the parent sanitizer.
- Mermaid directives cannot change security settings: source that tries to set
  `securityLevel`, `htmlLabels`, `startOnLoad`, `maxTextSize`, `maxEdges`,
  `themeCSS` or `suppressErrorRendering` through `%%{init}%%` or frontmatter
  `config:` stays source, including escaped spellings of those keys.
- Any `svg` fence is scrubbed in an inert document before page insertion. Only
  SVG-namespace elements and explicitly allowed drawing attributes survive.
  XHTML, scripts, animation, event handlers, `foreignObject`, embedded images,
  and non-fragment URLs are removed. The same boundary checks Mermaid output.
- Styles are contained. Authored `svg` fences keep no `<style>` element and no
  `class` attribute, and their inline styles keep only painter properties such
  as fill, stroke and font; layout properties (`position`, `inset`, `z-index`,
  ...) are removed, and paint containment on the figure body is the backstop
  against an overlay. CSS escapes are decoded before a URL check, and every
  `url()` reference must point to a fragment inside the same drawing. Mermaid's
  generated stylesheet is parsed with the browser's CSS parser and rebuilt rule
  by rule: only rules scoped to the rendered svg id survive, and any rule that
  could load a remote resource is dropped.
- Source limits are 50,000 Mermaid characters and 200,000 SVG characters. Parser
  limits cannot be overridden by source. Oversized or unsupported input stays
  source; these limits are not a guarantee against all browser CPU pressure.
- No CDN is used. The library request targets the package's fixed local asset
  route; the frame policy blocks resource loads requested by diagram content.

## How it works

| Half                  | Role                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.js` (Host)     | Serves the pinned Mermaid browser build from one fixed, read-only route (`/dsh-visual-assets/mermaid.min.js`) with a revalidating ETag cache. The route serves exactly one dependency asset and exposes no session state. |
| `client.js` (Browser) | Observes the Conversation transcript, adds a figure to each supported code block, and loads Mermaid on the first diagram.                                                                                                 |

The client bundle system serves only declared client bundles and image assets,
so the library is delivered by the Host route instead of being loaded eagerly
with the plugin: most sessions never draw a diagram.

The browser half never replaces a host component. It appends one owned
`<figure>` as the last child of the code block wrapper and hides the host's
banner and source with a class, which keeps React reconciliation and transcript
windowing intact.

## Pinned dependency

`mermaid` **12.2.0** is an exact dependency. The committed lockfile pins its
transitive dependencies and integrity hashes. Install with
`pnpm install --frozen-lockfile --ignore-scripts`; package installation must not
run dependency scripts. The workspace policy requires a seven-day minimum
release age for newly resolved packages.

The served UMD file is byte-identical to the original bundled browser build. Its
SHA-256 is `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f`.
The native validation gate checks this hash. Mermaid uses the MIT license; its
notice is retained in `vendor/LICENSE.mermaid`.

## Limits

- Only rendered transcript code blocks are enhanced. Terminal output, tool cards
  that do not use the Markdown code block, and files opened in the sidebar keep
  their own presentation.
- A diagram that Mermaid cannot parse stays visible as source; no error card is
  inserted into the transcript. The same applies to a fence whose directives try
  to change Mermaid security settings.
- Graphviz/DOT fences are not rendered: `graph` is also a Mermaid keyword, and
  without a shell language token the source cannot be told apart reliably.
- Export, print, and copy-from-transcript use the Markdown source, not the
  rendered drawing.

## Enable, disable, remove

The plugin is one bundle row in the active profile. Toggle it in **Settings →
Plugins**, or remove the bundle with the plugin manager. Disabling removes the
Host route and every drawing with it.

## Install from source

Clone this repository and run `pnpm install --frozen-lockfile --ignore-scripts`
with the pinned package-manager version. Then install the directory through the
DSH plugin manager. Keep the checkout in place: a local installation links to
this source. The package name stays unchanged so existing profiles can keep
their registration.

## Development

After cloning, run `scripts/setup-hooks`. This installs the repository's hooks
without changing Git configuration. It refuses to replace custom hooks.

```sh
scripts/setup-hooks
node scripts/check.mjs
node scripts/check.mjs smoke
```

Install Gitleaks, markdownlint-cli2, Semgrep, Lizard, and OSV Scanner before
contributing. Missing tools and failed checks block the relevant hook. Commits
must be signed, signed off, and use a Conventional Commit subject with a purpose
body. Never bypass hooks with `--no-verify`.

The native gate checks source syntax and hygiene, package and locale shape,
privacy patterns, distribution exports, and module registration. Generic push
checks also scan signatures, secrets, dependencies, source security, and
function complexity. Exercise the installed plugin in a local Web UI before
delivery; module registration alone does not prove its visible behavior.
