# Security boundaries

## Package asset boundary

[The Host asset table](../index.js) maps exact routes to fixed package files.
Request input never selects a filesystem path.
The route accepts read-only methods and serves no session state.
A failed read returns an error rather than an empty successful script.
The response uses a fixed content type and disables type sniffing.
Revalidation avoids a stale dependency at an unchanged URL.

## Opaque Mermaid realm

[The browser](../client.js) treats all diagram source as untrusted.
The Mermaid iframe permits scripts but has no same-origin permission.
Its content policy denies resources by default.
Only the fixed library script and trusted bootstrap receive script nonces.
Diagram source crosses through messages, never frame HTML.
Replies require both the expected Window and the private channel.
Queue, message, source, output, and time bounds live beside the realm policy.
These bounds do not guarantee protection against all browser CPU pressure.

Each render uses strict Mermaid configuration without HTML labels.
The directive guard examines the whole source after escape normalization.
It rejects protected configuration keys even inside a diagram label.
This conservative rejection prevents a partial directive from changing the policy.
The protected-key pattern and numeric bounds in the client are authoritative.

## SVG and CSS boundary

Both authored SVG and Mermaid output pass the parent sanitizer.
Authored SVG first passes sanitation in an inert document, before import.
This prevents active resource elements from reaching a live document unsanitized.
The sanitizer accepts only SVG namespace elements and explicit drawing attributes.
XLink references receive the same fragment-only policy as ordinary references.
Scripts, event handlers, embedded images, animation, and foreign HTML do not survive.

Authored SVG loses stylesheets and classes.
Inline declarations retain only allowed painter properties.
CSS escape and control normalization precede URL policy checks.
References accept fragment syntax rather than remote or data URLs.
The policy does not prove that a fragment target belongs to the same drawing.
Keep this distinction explicit in security claims.

Mermaid stylesheets pass through CSSOM parsing and rule reconstruction.
Style rules require the generated SVG scope and resource-safe values.
Supported containers receive recursive checks.
Resource-safe keyframes can survive. Unknown rules do not survive.
Painter restrictions and figure paint containment limit effects on shell layout.
The sanitizer's element, attribute, property, and rule policies remain separate
from Mermaid's own strict mode.

## Privacy, dependencies, and distribution

Parser diagnostics can contain transcript source.
The realm returns fixed errors rather than parser text.
The controller reports language, source length, and error identity instead of source.
The Host reports fixed asset paths rather than session data.

[The manifest](../package.json) owns dependency pins and the distribution allowlist.
[The lockfile](../pnpm-lock.yaml) owns resolved dependencies and integrity values.
[The workspace policy](../pnpm-workspace.yaml) owns release-age and build policy.
[The native gate](../scripts/check.mjs) owns the reviewed browser artifact hash.
A dependency update needs review of these sources together.
Keep the dependency license notice in [the vendor notice](../vendor/LICENSE.mermaid).

Keep local paths, credentials, logs, screenshots, hooks, and development files out
of distribution. Keep exports within the explicit distribution allowlist.
Keep security scans and signed-commit gates active before delivery.
The [development reference](DEVELOPMENT.md) owns setup and gate procedures.
