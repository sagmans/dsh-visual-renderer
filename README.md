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

Diagram source is untrusted input. Mermaid runs in an opaque sandbox with strict
configuration. Both Mermaid output and authored SVG pass a parent sanitizer.
Unsupported elements, unsafe styles, and non-fragment URLs do not survive.
Source that overrides protected Mermaid configuration stays visible as source.
The library comes from the local package, not a CDN.

The source bounds and sandbox reduce risk but do not prevent all browser CPU
pressure. The
[security reference](https://github.com/sagmans/dsh-visual-renderer/blob/main/docs/SECURITY.md)
explains the boundaries and their limits.

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

For setup, validation, local hooks, and browser proof, read
[Development](https://github.com/sagmans/dsh-visual-renderer/blob/main/docs/DEVELOPMENT.md).
For the Host/browser split and rendering lifecycle, read
[Architecture](https://github.com/sagmans/dsh-visual-renderer/blob/main/docs/ARCHITECTURE.md).
