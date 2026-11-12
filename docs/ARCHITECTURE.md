# Architecture

## Host and browser ownership

[The manifest](../package.json) declares separate Host and browser exports.
[The bundle patch](../cordis.patch.yml) joins both halves under one switch.
This keeps asset availability and transcript enhancement within one lifetime.

[The Host](../index.js) serves a fixed package file through an exact route.
The client bundle mechanism does not serve arbitrary dependency files.
Lazy asset reads avoid the library cost for sessions without diagrams.
A shared promise combines concurrent reads. A rejected read permits a later retry.
An ETag permits revalidation at the same URL after a package update.

[The browser](../client.js) uses the existing module loader.
The entry is a classic script. Its outer lexical block and function-expression
bindings prevent collisions and classic-script function-hoisting leaks.
Each factory owns its stylesheet reference and render counter.
Each application owns its enhancer, controllers, and Mermaid realm.
There is no parent-page Mermaid global.

## Transcript ownership and fallback

The shell owns the code block wrapper, banner, and source nodes.
An owned figure stays beside these nodes, rather than replacing them.
Visibility classes preserve React reconciliation and transcript windowing.
Removal restores source visibility, including after a failed attachment.

A bare banner token controls classification when one exists.
An unsupported token keeps the source visible.
Without a token, source matching handles localized banners.
Mermaid detection skips frontmatter, comments, and blank lines.
SVG detection uses a linear prefix scan to avoid costly regex backtracking.

Each controller owns one fence revision and one figure view.
Visibility observation delays work until a fence approaches the viewport.
Mutation observation routes changes to affected wrappers and excludes owned figures.
Revision checks discard stale results after source changes, theme changes, or disposal.
A growing invalid revision briefly retains the last complete drawing.
A settled invalid revision restores source, rather than adding an error graphic.
The source/diagram choice survives a successful redraw.

## Rendering realm and page insertion

One opaque iframe isolates Mermaid's library DOM effects from the shell.
The realm serializes requests because Mermaid initialization changes shared state.
Each request supplies its own configuration before rendering.
Bounded messages and timers limit queued asynchronous work.
A timeout destroys the realm and rejects all pending requests.
A later load can create a new realm.
The [security reference](SECURITY.md) owns the policy at this boundary.

Both renderer paths converge on the parent sanitizer before page insertion.
Authored SVG also passes sanitation before import from its inert document.
The shared finalization path keeps new renderers subject to the same boundary.
The authored-size rule preserves a viewBox width when explicit dimensions are absent.

## Theme, locale, and disposal

Theme tokens can contain CSS variable chains or appearance-dependent colors.
A temporary body probe resolves these tokens to concrete Mermaid colors.
The enhancer reads the theme once per refresh and exposes the current context
through a getter. Theme changes invalidate pending output and cached drawings.
Locale changes refresh toolbar text without resetting the source/diagram choice.
The client owns toolbar dictionaries and an English fallback.
The locale JSON files own package metadata, not toolbar strings.

Disposal disconnects observers before it restores source nodes.
This prevents cleanup mutations from starting more work.
Controllers invalidate pending results and cancel their timers.
The enhancer removes its stylesheet, and the realm rejects waiters before removal.
Context effects own the route, dictionary registration, subscriptions, and cleanup.
