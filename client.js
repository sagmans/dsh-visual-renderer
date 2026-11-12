/**
 * Browser half of the transcript visual renderer.
 *
 * The Conversation transcript is shipped, React-owned markup. This plugin does
 * not replace any host component: it finds rendered fenced code blocks whose
 * source asks for a drawing, renders the drawing itself, appends one owned
 * <figure> as the last child of the block wrapper, and hides the host source
 * only while a drawing is actually shown. Keeping the host nodes mounted and
 * only toggling classes is what makes this safe across React re-renders and
 * transcript windowing.
 *
 * The shell gives the fence language no stable DOM token: languages it does not
 * highlight render a localized label instead of the fence word. A renderer
 * therefore matches the *source* it understands. That makes the matchers the
 * trust boundary: they must be strict enough to never claim a normal code
 * block, and each format's matching rules live next to its renderer.
 *
 * Three constraints shape the implementation:
 * - Assistant replies stream: the fence text is rewritten for every delta, and
 *   most intermediate prefixes are not valid diagram source. Rendering is
 *   debounced and a still-growing fence keeps its last complete drawing until
 *   the next valid revision, so the transcript does not flicker.
 * - The Mermaid library is several megabytes, so it is fetched by an injected
 *   script only when the first supported fence appears. The Host half serves it
 *   from the package itself; no CDN is contacted.
 * - Diagram source is model output, therefore untrusted. Mermaid runs in strict
 *   mode, and every produced SVG passes one sanitize-and-fit step before it
 *   enters the document.
 */
{
  // Lexical bindings isolate concatenated bundles and permit hot replacement.
  // Function expressions avoid Annex B globals in non-strict classic scripts.
  /** Locale namespace owned by this package. */
  const NS = 'visual-renderer';

  /** Chat transcript root, owned by the Conversation target View. */
  const CHAT_FLOW_SELECTOR = '[data-slot="conversation.chat.flow"]';
  /** Rendered Markdown code block parts, owned by the shell's CodeBlock component. */
  const CODE_BLOCK_WRAPPER_SELECTOR = '.md-code-block';
  const CODE_BLOCK_CONTENT_SELECTOR = '[data-code-block-content]';
  const CODE_BLOCK_BANNER_SELECTOR = '[data-code-block-banner]';
  /** Attribute marking the figure this plugin owns; its subtree is never input. */
  const FIGURE_ATTRIBUTE = 'data-dsh-visual';
  /** Class hiding the host banner and source while a drawing is shown. */
  const SOURCE_HIDDEN_CLASS = 'dsh-visual-source-hidden';
  /** Class prefix for the owned figure and its parts. */
  const VISUAL_CLASS_PREFIX = 'dsh-visual';
  /** Figure state values carried in `data-dsh-visual-state`. */
  const STATE_DIAGRAM = 'diagram';
  const STATE_SOURCE = 'source';
  /**
   * Host route serving the vendored Mermaid UMD build (see index.js).
   * Document-relative on purpose: the shell serves its own plugin bundles the
   * same way, so a deployment under a path prefix keeps the prefix.
   */
  const MERMAID_ASSET_PATH = 'dsh-visual-assets/mermaid.min.js';
  /** Prefix for the DOM ids Mermaid requires per render. */
  const MERMAID_ID_PREFIX = 'dsh-visual-mermaid-';
  /** Debounce for one fence render; streaming writes several deltas per frame. */
  const RENDER_DEBOUNCE_MS = 120;
  /** Debounce for a theme refresh, which touches every drawing at once. */
  const REFRESH_DEBOUNCE_MS = 150;
  /** Extra root margin so a fence renders slightly before it scrolls into view. */
  const VISIBILITY_ROOT_MARGIN = '240px 0px';
  /** Tallest a drawing may render before it scrolls inside its own body. */
  const MAX_VISUAL_HEIGHT_VH = 70;
  /** Bounds that keep a hostile or accidental fence from freezing the page. */
  const MAX_MERMAID_SOURCE_CHARS = 50_000;
  const MAX_SVG_SOURCE_CHARS = 200_000;
  const MAX_MERMAID_EDGES = 500;
  /**
   * Grace period before an invalid rendering falls back to source. Fence
   * prefixes during streaming are invalid by construction; the drawing stays
   * until the source has been quiet for this long and is still invalid.
   */
  const INVALID_SETTLE_MS = 400;
  /** Attribute marking the owned style element, so disposal removes exactly it. */
  const STYLE_ATTRIBUTE = 'data-dsh-visual-style';
  /** Bare information-string shape accepted from the code block banner. */
  const LANGUAGE_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_+#.-]{0,31}$/u;
  /**
   * Mermaid directive keywords. A shell-provided fence token rarely exists
   * for these languages, so the first directive line is the reliable signal.
   * The list covers every diagram family Mermaid 12 declares as a start
   * token, including the `-beta` families and the C4 variants; a missing
   * keyword would silently leave that diagram as source.
   */
  const MERMAID_DIRECTIVE_PATTERN =
    /^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|block-beta|xychart-beta|packet-beta|architecture-beta|kanban|radar-beta|treemap-beta|railroad|railroad-beta|venn|venn-beta|cynefin|cynefin-beta|eventmodeling|treeView|usecase|ishikawa|wardley|wardley-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/u;
  /** Namespace a real SVG root must carry after parsing. */
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  /**
   * Keys an untrusted Mermaid directive may not set; see assertSafeDirectives.
   * Includes the parser limits, because a source-level override would defeat
   * the bounds the plugin states.
   */
  const MERMAID_FORBIDDEN_CONFIG_PATTERN =
    /(?:securitylevel|htmllabels|startonload|maxtextsize|maxedges|themecss|suppresserrorrendering)["']?\s*:/iu;
  /** Only inert SVG painter vocabulary may cross into the host document. */
  const ALLOWED_SVG_ELEMENTS = new Set([
    'svg',
    'g',
    'defs',
    'title',
    'desc',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'textPath',
    'marker',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'mask',
    'pattern',
    'symbol',
    'use',
    'filter',
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feComposite',
    'feConvolveMatrix',
    'feDiffuseLighting',
    'feDisplacementMap',
    'feDistantLight',
    'feDropShadow',
    'feFlood',
    'feFuncA',
    'feFuncB',
    'feFuncG',
    'feFuncR',
    'feGaussianBlur',
    'feMerge',
    'feMergeNode',
    'feMorphology',
    'feOffset',
    'fePointLight',
    'feSpecularLighting',
    'feSpotLight',
    'feTile',
    'feTurbulence',
    'style',
  ]);
  /** Unknown attributes fail closed rather than acquiring new browser behavior. */
  const ALLOWED_SVG_ATTRIBUTES = new Set([
    'id',
    'class',
    'style',
    'role',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-roledescription',
    'aria-hidden',
    'viewBox',
    'preserveAspectRatio',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'width',
    'height',
    'd',
    'points',
    'pathLength',
    'dx',
    'dy',
    'rotate',
    'textLength',
    'lengthAdjust',
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'opacity',
    'color',
    'visibility',
    'display',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-variant',
    'text-anchor',
    'dominant-baseline',
    'alignment-baseline',
    'baseline-shift',
    'letter-spacing',
    'word-spacing',
    'text-decoration',
    'paint-order',
    'transform',
    'vector-effect',
    'shape-rendering',
    'text-rendering',
    'marker-start',
    'marker-mid',
    'marker-end',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'orient',
    'refX',
    'refY',
    'clip-path',
    'clip-rule',
    'clipPathUnits',
    'mask',
    'maskUnits',
    'maskContentUnits',
    'filter',
    'filterUnits',
    'primitiveUnits',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'offset',
    'stop-color',
    'stop-opacity',
    'fx',
    'fy',
    'fr',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'href',
    'in',
    'in2',
    'result',
    'type',
    'values',
    'mode',
    'operator',
    'k1',
    'k2',
    'k3',
    'k4',
    'order',
    'kernelMatrix',
    'divisor',
    'bias',
    'targetX',
    'targetY',
    'edgeMode',
    'kernelUnitLength',
    'preserveAlpha',
    'surfaceScale',
    'diffuseConstant',
    'specularConstant',
    'specularExponent',
    'limitingConeAngle',
    'azimuth',
    'elevation',
    'stdDeviation',
    'radius',
    'scale',
    'xChannelSelector',
    'yChannelSelector',
    'flood-color',
    'flood-opacity',
    'lighting-color',
    'slope',
    'intercept',
    'amplitude',
    'exponent',
    'tableValues',
    'baseFrequency',
    'numOctaves',
    'seed',
    'stitchTiles',
    'startOffset',
    'method',
    'spacing',
  ]);
  /** XLink is accepted solely for the same fragment-only href policy. */
  const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
  /** Realm policy bounds asynchronous work and keeps layout outside host UI. */
  const REALM_NONCE_BYTES = 24;
  const REALM_LOAD_TIMEOUT_MS = 15_000;
  const REALM_RENDER_TIMEOUT_MS = 20_000;
  const MAX_REALM_PENDING = 16;
  const MAX_RENDERED_SVG_CHARS = 2_000_000;
  const MAX_REALM_MESSAGE_CHARS = 120_000;
  const REALM_FRAME_STYLE =
    'position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden;pointer-events:none;border:0';
  /** URL function targets must be complete, nonempty local fragment tokens. */
  const CSS_URL_START_PATTERN = /url\s*\(/giu;
  const FRAGMENT_TARGET_PATTERN = /^#[^\s"'()<>]+$/u;
  /** Bound on a single stylesheet; Mermaid generates a few kilobytes. */
  const MAX_STYLE_TEXT_CHARS = 64_000;
  /** CSSStyleRule cssRules type id (CSSOM is stable on these values). */
  const CSS_RULE_STYLE = 1;
  /** CSSMediaRule and CSSSupportsRule: containers whose children are checked. */
  const CSS_RULE_CONTAINERS = new Set([4, 12]);
  /** CSSKeyframesRule: allowed only when its serialized text is resource-free. */
  const CSS_RULE_KEYFRAMES = 7;
  /**
   * Serialized-CSS constructs that resolve a remote resource or execute code.
   * CSSOM serialization removes comments and decodes escapes, so a check on
   * the parsed rule text cannot be bypassed the way a raw-text regex can.
   */
  const UNSAFE_CSS_TEXT_PATTERN = /@import|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:/iu;
  /** URL scheme checks must see the same control-free text the browser resolves. */
  const URL_SPACE_CHAR_CODE = 0x20;
  const URL_DELETE_CHAR_CODE = 0x7f;
  /** Top-level comma splitter for selector lists (respects brackets/quotes). */
  const SELECTOR_SPLIT = /,(?![^(\[]*\))/u;
  /**
   * Style properties a drawing may set on its own elements.
   *
   * An `svg` root in the page is subject to ordinary CSS: `position: fixed`
   * plus a viewport size covers the whole application even though the figure
   * clips its children. Only painter properties are allowed, so no fence can
   * move a drawing out of its own box or touch page layout.
   */
  const ALLOWED_STYLE_PROPERTIES = new Set([
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'opacity',
    'color',
    'visibility',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'dominant-baseline',
    'letter-spacing',
    'word-spacing',
    'paint-order',
    'marker-start',
    'marker-mid',
    'marker-end',
    'stop-color',
    'stop-opacity',
    'transform',
    // Mermaid sizes its root with an inline max-width; keeping it prevents a
    // `width="100%"` root from inflating the whole drawing.
    'max-width',
  ]);
  /** Color roles read from host theme tokens and mapped to Mermaid variables. */
  const THEME_TOKEN_MAP = Object.freeze({
    background: '--dsw-alias-bg-base',
    primaryColor: '--dsw-alias-bg-layer-1',
    primaryTextColor: '--dsw-alias-label-primary',
    primaryBorderColor: '--dsw-alias-border-l1',
    secondaryColor: '--dsw-alias-bg-layer-2',
    tertiaryColor: '--dsw-alias-bg-layer-2',
    lineColor: '--dsw-alias-border-l2',
    textColor: '--dsw-alias-label-primary',
    mainBkg: '--dsw-alias-bg-layer-1',
    nodeBorder: '--dsw-alias-border-l1',
    clusterBkg: '--dsw-alias-bg-layer-2',
    clusterBorder: '--dsw-alias-border-l1',
    edgeLabelBackground: '--dsw-alias-bg-base',
    titleColor: '--dsw-alias-label-primary',
  });
  /** Used only when a token is missing, e.g. an older shell without the tokens. */
  const FALLBACK_THEME_COLORS = Object.freeze({
    background: '#ffffff',
    primaryColor: '#ffffff',
    primaryTextColor: '#111111',
    primaryBorderColor: '#d0d0d0',
    secondaryColor: '#f4f4f4',
    tertiaryColor: '#f4f4f4',
    lineColor: '#909090',
    textColor: '#111111',
    mainBkg: '#ffffff',
    nodeBorder: '#d0d0d0',
    clusterBkg: '#f4f4f4',
    clusterBorder: '#d0d0d0',
    edgeLabelBackground: '#ffffff',
    titleColor: '#111111',
  });
  /** Font stack used when the host container exposes no computed family. */
  const FALLBACK_FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif';

  /** English strings; kept flat so every surface binds one dictionary. */
  const EN = {
    'label.mermaid': 'Mermaid diagram',
    'label.svg': 'SVG graphic',
    'action.source': 'Show source',
    'action.diagram': 'Show diagram',
  };
  /** Chinese strings kept beside the English ones for the same keys. */
  const ZH = {
    'label.mermaid': 'Mermaid 图表',
    'label.svg': 'SVG 图形',
    'action.source': '查看源码',
    'action.diagram': '查看图表',
  };

  /**
   * Owned stylesheet. Host theme tokens keep the figure inside the current
   * appearance without copying colors; the fallbacks cover an older shell.
   * `svg` is a block so the figure body has no line-box gap.
   */
  const STYLE_TEXT = `
.dsh-visual { margin: 12px 0; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.25)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, transparent); overflow: hidden; }
.dsh-visual__toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2)); }
.dsh-visual__label { font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #666); }
.dsh-visual__toggle { margin-left: auto; padding: 2px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #666); font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; }
.dsh-visual__toggle:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12)); color: var(--dsw-alias-label-primary, #111); }
.dsh-visual__toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2f6feb); outline-offset: 1px; }
.dsh-visual__canvas { display: flex; justify-content: center; padding: 12px; overflow: auto; contain: paint; max-height: ${MAX_VISUAL_HEIGHT_VH}vh; }
.dsh-visual__canvas svg { display: block; max-width: 100%; max-height: ${MAX_VISUAL_HEIGHT_VH}vh; height: auto; }
.dsh-visual[data-dsh-visual-state="source"] .dsh-visual__canvas { display: none; }
.dsh-visual-source-hidden { display: none !important; }
`;

  /** Translate one key against the package dictionary, falling back to English. */
  const translate = function translate(t, key) {
    const value = t(key);
    // A missing dictionary entry usually echoes the key; fall back to the
    // packaged English copy so a half-translated locale never shows raw keys.
    return typeof value === 'string' && value.length > 0 && value !== key ? value : (EN[key] ?? key);
  };

  /**
   * Read the first line that Mermaid interprets as a directive.
   *
   * Mermaid accepts YAML frontmatter, `%%` comments and `%%{init}%%`
   * directives before the diagram keyword, and it ignores leading blank
   * lines; matching only line one would leave those fences as source.
   * @param {string} source - fence source.
   * @returns {string} trimmed directive line, or the empty string.
   */
  const firstDirectiveLine = function firstDirectiveLine(source) {
    const lines = source.replace(/^\uFEFF/u, '').split('\n');
    let index = 0;
    // Skip a leading YAML frontmatter block: its content is configuration,
    // never a diagram keyword.
    if (lines[0]?.trim() === '---') {
      index = 1;
      while (index < lines.length && lines[index].trim() !== '---') index += 1;
      index += 1;
    }
    for (; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (line.length === 0) continue;
      if (line.startsWith('%%')) continue;
      return line;
    }
    return '';
  };

  /**
   * Tell whether a fence source starts with an SVG root element.
   *
   * A regex with nested lazy groups backtracks catastrophically on many
   * comments, so this uses a linear prefix scan instead: skip the XML
   * declaration, comments and doctype by index, then check the root name.
   * @param {string} source - fence source.
   * @returns {boolean} true when the first element is `<svg>`.
   */
  const looksLikeSvgSource = function looksLikeSvgSource(source) {
    let rest = source.replace(/^\uFEFF/u, '').trimStart();
    for (;;) {
      if (rest.startsWith('<?xml')) {
        const end = rest.indexOf('?>');
        if (end < 0) return false;
        rest = rest.slice(end + 2).trimStart();
        continue;
      }
      if (rest.startsWith('<!--')) {
        const end = rest.indexOf('-->');
        if (end < 0) return false;
        rest = rest.slice(end + 3).trimStart();
        continue;
      }
      if (rest.startsWith('<!DOCTYPE')) {
        const end = rest.indexOf('>');
        if (end < 0) return false;
        rest = rest.slice(end + 1).trimStart();
        continue;
      }
      break;
    }
    return /^<svg[\s>]/iu.test(rest);
  };

  /**
   * Reject Mermaid source whose leading directives change security settings.
   *
   * Mermaid applies `%%{init}%%` and frontmatter `config:` after the plugin's
   * own `initialize`, so a fence could otherwise switch `securityLevel` to
   * loose or enable HTML labels. There is no safe way to rewrite a partial
   * directive, so such a fence stays source (fail closed). Only the prefix is
   * inspected: directives are a leading construct, and a label far inside the
   * diagram must not trip the guard.
   * @param {string} source - diagram source.
   * @throws {Error} when a security-sensitive key appears in the directive prefix.
   */
  /**
   * Decode the escape forms a directive can use to hide a key name.
   *
   * Mermaid parses init directives as JSON5/JS objects, so `\u004c` becomes
   * `L` before the key is compared. Decoding the same forms here means the
   * guard sees the key the parser will see; any leftover backslash is dropped
   * so a partial escape cannot split a keyword either.
   * @param {string} text - directive prefix text.
   * @returns {string} lowercase, escape-free text.
   */
  const normalizeDirectiveText = function normalizeDirectiveText(text) {
    return text
      .replace(/\\u\{([0-9a-f]+)\}/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\x([0-9a-f]{2})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\/gu, '')
      .toLowerCase();
  };

  /**
   * Reject Mermaid source whose leading directives change security settings.
   *
   * Mermaid applies `%%{init}%%` and frontmatter `config:` after the plugin's
   * own `initialize`, so a fence could otherwise switch `securityLevel` to
   * loose or raise the parser bounds. There is no safe way to rewrite a
   * partial directive, so such a fence stays source (fail closed). The whole
   * prefix before the diagram keyword is inspected: frontmatter has no line
   * cap and a multi-line init directive is covered because the prefix ends at
   * the first line that is not configuration.
   * @param {string} source - diagram source.
   * @throws {Error} when a security-sensitive key appears in the directive prefix.
   */
  const assertSafeDirectives = function assertSafeDirectives(source) {
    // The whole source is inspected: Mermaid also applies `%%{init}%%` lines
    // that trail the diagram keyword, and a frontmatter key that looks like a
    // directive can end a prefix scan early. A label that happens to contain
    // one of these keys is refused too; that is the fail-closed trade for a
    // control that cannot rewrite a partial directive.
    if (MERMAID_FORBIDDEN_CONFIG_PATTERN.test(normalizeDirectiveText(source.replace(/^\uFEFF/u, '')))) {
      throw new Error('visual-renderer: diagram tries to override Mermaid security settings');
    }
  };

  /**
   * Read the diagram source from a code block content element.
   *
   * The Markdown renderer appends a space after fence content to keep empty
   * trailing lines; diagram parsers read that as an empty last line, so only
   * the tail whitespace is trimmed and internal formatting is preserved.
   * @param {Element} content - `[data-code-block-content]` element.
   * @returns {string} fence source.
   */
  const readSource = function readSource(content) {
    const pre = content.querySelector('pre');
    const text = (pre ?? content).textContent ?? '';
    return text.replace(/\s+$/u, '');
  };

  /**
   * Read a fence language only when the shell rendered one.
   *
   * Highlighted languages show their token; the shell's localized label for
   * an unknown language is prose and never matches the pattern.
   * @param {Element} wrapper - `.md-code-block` wrapper.
   * @returns {string | null} lowercase language token, or null when absent.
   */
  const readBannerLanguage = function readBannerLanguage(wrapper) {
    const banner = wrapper.querySelector(CODE_BLOCK_BANNER_SELECTOR);
    if (banner === null) return null;
    // Only the first leaf span is the language slot. Scanning every span
    // would let a secondary control label ("Copy") veto a real diagram.
    const span = banner.querySelector('span');
    if (span !== null && span.childElementCount === 0) {
      const token = (span.textContent ?? '').trim();
      if (LANGUAGE_TOKEN_PATTERN.test(token)) return token.toLowerCase();
    }
    // The plain, card-less header renders the language as the first child's
    // text; the card header's first child holds the same label plus controls,
    // so the token pattern only accepts an exact bare token.
    const first = banner.firstElementChild;
    if (first !== null) {
      const token = (first.textContent ?? '').trim();
      if (LANGUAGE_TOKEN_PATTERN.test(token)) return token.toLowerCase();
    }
    return null;
  };

  /**
   * Validate one selector list against the render's own scope.
   *
   * Only selectors rooted at the generated SVG id survive, so a stylesheet
   * can style its own drawing and cannot reach host UI.
   * @param {string} selectorText - CSSOM-serialized selector list.
   * @param {string} scopeSelector - `#<render id>` root.
   * @returns {string | null} the selector list, or null when out of scope.
   */
  const scopedSelector = function scopedSelector(selectorText, _scopeSelector, scopePattern) {
    const parts = selectorText.split(SELECTOR_SPLIT).map((part) => part.trim());
    if (parts.length === 0) return null;
    for (const part of parts) {
      if (!scopePattern.test(part)) return null;
      if (isUnsafeCssValue(part)) return null;
    }
    return parts.join(', ');
  };

  /**
   * Rebuild a stylesheet from allowed CSSOM rules.
   *
   * Parsing with CSSOM first is the point: the browser resolves comments,
   * escapes and normalization, so validation inspects the rules that would
   * actually apply instead of a raw string a crafted comment can hide from.
   * @param {CSSRuleList} rules - parsed rules.
   * @param {string} scopeSelector - `#<render id>` root.
   * @returns {string} serialized allowed rules.
   */
  const collectSafeRules = function collectSafeRules(rules, scopeSelector) {
    const output = [];
    const scopePattern = new RegExp(
      `^${scopeSelector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[\\s>+~.#:\\[])`,
      'u',
    );
    for (const rule of rules) {
      if (rule.type === CSS_RULE_STYLE) {
        const selector = scopedSelector(rule.selectorText, scopeSelector, scopePattern);
        if (selector === null) continue;
        const body = rule.style.cssText;
        if (isUnsafeCssValue(body)) continue;
        output.push(`${selector}{${body}}`);
        continue;
      }
      if (CSS_RULE_CONTAINERS.has(rule.type)) {
        const inner = collectSafeRules(rule.cssRules, scopeSelector);
        if (inner.length === 0) continue;
        // Keep the at-keyword the rule was written with; rewriting @supports
        // as @media would make the block invalid CSS.
        const keyword = rule.type === 4 ? '@media' : '@supports';
        output.push(`${keyword} ${rule.conditionText}{${inner}}`);
        continue;
      }
      if (rule.type === CSS_RULE_KEYFRAMES) {
        const text = rule.cssText;
        if (!isUnsafeCssValue(text)) output.push(text);
        continue;
      }
      // @import, @font-face, @namespace and anything unknown are dropped.
    }
    return output.join('');
  };

  /**
   * Replace or drop the stylesheets inside one SVG.
   *
   * Inline SVG stylesheets apply to the whole document, so a raw `svg` fence
   * could otherwise hide or restyle host UI and fetch remote CSS. Mermaid's
   * generated stylesheet is scoped to the render id and can therefore be
   * kept after CSSOM validation; an authored fence has no trusted scope, so
   * its stylesheets are always dropped.
   * @param {SVGSVGElement} svg - SVG root.
   * @param {string | null} renderId - Mermaid render id, or null for raw SVG.
   */
  const sanitizeStyleSheets = function sanitizeStyleSheets(svg, renderId) {
    const styleElements = [...svg.querySelectorAll('style')];
    if (styleElements.length === 0) return;
    if (renderId === null) {
      for (const element of styleElements) element.remove();
      return;
    }
    const scopeSelector = `#${renderId}`;
    for (const element of styleElements) {
      const text = element.textContent ?? '';
      if (text.length === 0 || text.length > MAX_STYLE_TEXT_CHARS) {
        element.remove();
        continue;
      }
      const document_ = document.implementation.createHTMLDocument('');
      const parsed = document_.createElement('style');
      parsed.textContent = text;
      document_.head.append(parsed);
      const sheet = parsed.sheet;
      if (sheet === null) {
        element.remove();
        continue;
      }
      const safeText = collectSafeRules(sheet.cssRules, scopeSelector);
      if (safeText.length === 0) element.remove();
      else element.textContent = safeText;
    }
  };

  /**
   * Decode CSS escape forms before a URL check.
   *
   * CSS lets `url(` be written as `u\\72l(`; a raw regex sees neither the
   * keyword nor the scheme. Decoding first makes the check inspect the value
   * the browser will parse.
   * @param {string} text - CSS value or serialized declaration.
   * @returns {string} decoded text.
   */
  const decodeCssEscapes = function decodeCssEscapes(text) {
    return text
      .replace(/\\([0-9a-fA-F]{1,6})\s?/gu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\(.)/gsu, '$1');
  };

  /** URL parsers ignore ASCII controls within schemes; policy must do the same. */
  const stripUrlControls = function stripUrlControls(text) {
    return Array.from(text).filter((character) => {
      const code = character.charCodeAt(0);
      return code > URL_SPACE_CHAR_CODE && code !== URL_DELETE_CHAR_CODE;
    }).join('');
  };

  /**
   * Whether a CSS value can resolve a resource outside the drawing.
   *
   * Fragment-only `url(#id)` references stay because gradients and markers
   * use them; any other URL, an @import, or an executable construct rejects
   * the value.
   * @param {string} value - raw CSS value.
   * @returns {boolean} true when the value is not safe.
   */
  const isUnsafeCssValue = function isUnsafeCssValue(value) {
    // ASCII whitespace and controls are removed before the scheme check: a
    // URL parser ignores them inside a scheme (`java\tscript:`), so the
    // check must see the same text the browser will act on.
    const decoded = stripUrlControls(decodeCssEscapes(value));
    if (UNSAFE_CSS_TEXT_PATTERN.test(decoded)) return true;
    const starts = new RegExp(CSS_URL_START_PATTERN.source, CSS_URL_START_PATTERN.flags);
    while (starts.exec(decoded) !== null) {
      const end = decoded.indexOf(')', starts.lastIndex);
      if (end < 0) return true;
      let target = decoded.slice(starts.lastIndex, end);
      if (target.startsWith('"') || target.startsWith("'")) {
        if (target.at(-1) !== target[0]) return true;
        target = target.slice(1, -1);
      }
      if (!FRAGMENT_TARGET_PATTERN.test(target)) return true;
      starts.lastIndex = end + 1;
    }
    return false;
  };

  /**
   * Split a CSS declaration list without breaking on quoted semicolons.
   * @param {string} text - declaration text.
   * @returns {string[]} declarations.
   */
  const splitCssDeclarations = function splitCssDeclarations(text) {
    const parts = [];
    let current = '';
    let quote = null;
    let depth = 0;
    for (const char of text) {
      if (quote !== null) {
        current += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        current += char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ';' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim().length > 0) parts.push(current);
    return parts;
  };

  /**
   * Reduce an element's `style` attribute to painter properties.
   *
   * Keeps authored fills, strokes and text styling while dropping anything
   * that can affect page layout or load a resource.
   * @param {Element} element - SVG element with a possibly hostile style.
   */
  const sanitizeStyleAttribute = function sanitizeStyleAttribute(element) {
    const raw = element.getAttribute('style');
    if (raw === null) return;
    const kept = [];
    for (const declaration of splitCssDeclarations(raw)) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
      const value = declaration.slice(colon + 1).trim();
      if (value.length === 0 || isUnsafeCssValue(value)) continue;
      kept.push(`${property}:${value}`);
    }
    if (kept.length === 0) element.removeAttribute('style');
    else element.setAttribute('style', kept.join(';'));
  };

  /**
   * Scrub one SVG subtree before insertion.
   *
   * Mermaid output is sanitized by Mermaid in strict mode and raw `svg`
   * fences are parsed in an inert document first. This pass is the single
   * audit point for both: model output crosses into a privileged document, so
   * executable elements (including SMIL animation), document-wide stylesheet
   * constructs, event attributes and anything that would resolve a remote URL
   * are removed rather than trusted.
   * @param {SVGSVGElement} svg - detached SVG root.
   * @param {string | null} renderId - Mermaid render id, or null for raw SVG.
   */
  const sanitizeSvg = function sanitizeSvg(svg, renderId) {
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (element.namespaceURI !== SVG_NAMESPACE || !ALLOWED_SVG_ELEMENTS.has(element.localName)) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) sanitizeSvgAttribute(element, attribute, renderId);
    }
    sanitizeStyleSheets(svg, renderId);
  };

  /**
   * Namespace and vocabulary precede value checks. XLink aliases are matched by
   * namespace/local name, so changing a prefix cannot bypass fragment-only URLs.
   */
  const sanitizeSvgAttribute = function sanitizeSvgAttribute(element, attribute, renderId) {
    const local = attribute.localName;
    const namespacedHref = attribute.namespaceURI === XLINK_NAMESPACE && local === 'href';
    if ((attribute.namespaceURI !== null && !namespacedHref) || !ALLOWED_SVG_ATTRIBUTES.has(local)) {
      element.removeAttributeNode(attribute);
      return;
    }
    if (local === 'style') {
      sanitizeStyleAttribute(element);
      return;
    }
    if (local === 'class' && renderId === null) {
      element.removeAttributeNode(attribute);
      return;
    }
    if (local === 'href') {
      if (!FRAGMENT_TARGET_PATTERN.test(attribute.value.trim())) element.removeAttributeNode(attribute);
      return;
    }
    if (isUnsafeCssValue(attribute.value)) element.removeAttributeNode(attribute);
  };

  /**
   * Finalize one renderer's output: the only place a drawing is sanitized and
   * sized. A new renderer cannot skip either step by construction.
   * @param {{ svg: SVGSVGElement, renderId: string | null }} rendered - raw output.
   * @param {boolean} authoredSize - keep the source's own pixel size when it
   *   declares none; Mermaid publishes its own natural width instead.
   * @returns {SVGSVGElement} the same root, safe to insert.
   */
  const finalizeSvg = function finalizeSvg(rendered, authoredSize) {
    const { svg, renderId } = rendered;
    sanitizeSvg(svg, renderId);
    if (authoredSize) {
      const viewBox = svg.getAttribute('viewBox');
      const hasSize = svg.getAttribute('width') !== null || svg.getAttribute('height') !== null;
      if (viewBox !== null && !hasSize) {
        const width = Number(viewBox.trim().split(/[\s,]+/u)[2]);
        if (Number.isFinite(width) && width > 0) svg.style.width = `${width}px`;
      }
    }
    return svg;
  };

  /** Ensure the owned stylesheet exists exactly once. */
  const installStyle = function installStyle(runtime) {
    if (runtime.styleElement !== null && runtime.styleElement.isConnected) return;
    runtime.styleElement = document.createElement('style');
    runtime.styleElement.setAttribute(STYLE_ATTRIBUTE, '');
    runtime.styleElement.textContent = STYLE_TEXT;
    document.head.append(runtime.styleElement);
  };

  /** Remove the owned stylesheet. */
  const removeStyle = function removeStyle(runtime) {
    if (runtime.styleElement !== null && runtime.styleElement.isConnected) runtime.styleElement.remove();
    runtime.styleElement = null;
  };

  /** The trusted bootstrap receives policy, never interpolated diagram source. */
  const mermaidRealmBootstrap = function mermaidRealmBootstrap(policy) {
    const parentWindow = globalThis.parent;
    let queued = 0;
    let queue = Promise.resolve();
    const send = (message) => parentWindow.postMessage({ channel: policy.channel, ...message }, '*');
    const run = async (request) => {
      try {
        const library = globalThis.mermaid;
        if (!library) throw new Error('library-unavailable');
        // Per-request initialization prevents queued renders from sharing config.
        library.initialize(request.config);
        const result = await library.render(request.renderId, request.source);
        const svg = typeof result === 'string' ? result : result?.svg;
        if (typeof svg !== 'string' || svg.length > policy.maxOutput) throw new Error('invalid-output');
        send({ type: 'result', id: request.id, svg });
      } catch {
        // Parser diagnostics can contain the source; only a fixed error crosses.
        send({ type: 'error', id: request.id });
      } finally {
        queued -= 1;
      }
    };
    globalThis.addEventListener('message', (event) => {
      const request = event.data;
      if (event.source !== parentWindow || request?.channel !== policy.channel || request.type !== 'render') return;
      if (typeof request.id !== 'string' || typeof request.source !== 'string') return;
      if (request.source.length > policy.maxSource || queued >= policy.maxPending) return;
      if (typeof request.renderId !== 'string' || !/^dsh-visual-mermaid-\d+$/u.test(request.renderId)) return;
      if (typeof request.config !== 'object' || request.config === null) return;
      queued += 1;
      queue = queue.then(() => run(request));
    });
    // The static external script precedes this bootstrap, so ready means loaded.
    send({ type: globalThis.mermaid ? 'ready' : 'unavailable' });
  };

  /** Secure channels must not be guessable by sibling frames or transcript code. */
  const realmNonce = function realmNonce() {
    return Array.from(
      crypto.getRandomValues(new Uint8Array(REALM_NONCE_BYTES)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  };

  /** Only trusted package URLs and bootstrap text enter srcdoc, never model text. */
  const realmDocument = function realmDocument(spec, channel, nonce) {
    const policy = {
      channel,
      maxSource: MAX_MERMAID_SOURCE_CHARS,
      maxOutput: MAX_RENDERED_SVG_CHARS,
      maxPending: MAX_REALM_PENDING,
    };
    const bootstrap = `(${mermaidRealmBootstrap.toString()})(${JSON.stringify(policy)});`;
    const asset = new URL(spec.path, document.baseURI).href.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(
      /</gu,
      '&lt;',
    );
    const csp =
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    return `<meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}" src="${asset}"></script><script nonce="${nonce}">${bootstrap}</script>`;
  };

  /** One opaque realm owns all library DOM effects and is destroyed on timeout. */
  class SandboxedMermaidLibrary {
    constructor(spec) {
      this.spec = spec;
      this.frame = null;
      this.ready = null;
      this.pending = new Map();
      this.listener = null;
      this.readyTimer = 0;
      this.rejectReady = null;
    }

    /** The proxy keeps the existing renderer interface without a parent global. */
    load(logFailure) {
      if (this.ready !== null) return this.ready;
      const channel = realmNonce();
      const frame = document.createElement('iframe');
      this.frame = frame;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('aria-hidden', 'true');
      frame.title = 'Diagram renderer';
      frame.tabIndex = -1;
      frame.referrerPolicy = 'no-referrer';
      frame.credentialless = true;
      frame.style.cssText = REALM_FRAME_STYLE;
      let config;
      const proxy = {
        initialize(next) {
          config = next;
        },
        render: (renderId, source) => this.request(channel, renderId, source, config),
      };
      this.ready = new Promise((resolve, reject) => {
        this.rejectReady = reject;
        this.listener = (event) => this.onMessage(event, frame, channel, resolve, proxy);
        globalThis.addEventListener('message', this.listener);
        this.readyTimer = globalThis.setTimeout(() => this.fail('library-timeout'), REALM_LOAD_TIMEOUT_MS);
        frame.srcdoc = realmDocument(this.spec, channel, realmNonce());
        document.body.append(frame);
      }).catch((error) => {
        logFailure('Mermaid realm unavailable', error);
        throw error;
      });
      return this.ready;
    }

    /** Both the sending Window and unpredictable channel authenticate replies. */
    onMessage(event, frame, channel, resolve, proxy) {
      const message = event.data;
      if (event.source !== frame.contentWindow || message?.channel !== channel) return;
      if (message.type === 'ready') {
        clearTimeout(this.readyTimer);
        this.readyTimer = 0;
        this.rejectReady = null;
        resolve(proxy);
        return;
      }
      if (message.type === 'unavailable') {
        this.fail('library-unavailable');
        return;
      }
      if (typeof message.id !== 'string') return;
      const request = this.pending.get(message.id);
      if (request === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (
        message.type === 'result' && typeof message.svg === 'string' && message.svg.length <= MAX_RENDERED_SVG_CHARS
      ) {
        request.resolve({ svg: message.svg });
      } else request.reject(new Error('visual-renderer: diagram rejected by isolated renderer'));
    }

    /** Bounded messages avoid unbounded work even while several fences stream. */
    request(channel, renderId, source, config) {
      if (this.frame === null || this.rejectReady !== null) {
        return Promise.reject(new Error('visual-renderer: realm unavailable'));
      }
      if (this.pending.size >= MAX_REALM_PENDING || source.length > MAX_MERMAID_SOURCE_CHARS) {
        return Promise.reject(new Error('visual-renderer: renderer capacity exceeded'));
      }
      const id = realmNonce();
      const message = { channel, type: 'render', id, renderId, source, config };
      if (JSON.stringify(message).length > MAX_REALM_MESSAGE_CHARS) {
        return Promise.reject(new Error('visual-renderer: render request too large'));
      }
      return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => this.fail('render-timeout'), REALM_RENDER_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
        try {
          this.frame.contentWindow.postMessage(message, '*');
        } catch {
          this.fail('message-failed');
        }
      });
    }

    /** Removing the realm also stops work whose timer expired mid-render. */
    fail(reason) {
      this.unload(new Error(`visual-renderer: ${reason}`));
    }

    /** Disposal rejects every waiter before releasing the Window and listener. */
    unload(error = new Error('visual-renderer: renderer disposed')) {
      clearTimeout(this.readyTimer);
      this.readyTimer = 0;
      this.rejectReady?.(error);
      this.rejectReady = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      if (this.listener !== null) globalThis.removeEventListener('message', this.listener);
      this.listener = null;
      this.frame?.remove();
      this.frame = null;
      this.ready = null;
    }
  }

  /**
   * Read the host's theme colors through a body-level probe element.
   *
   * Theme tokens are declared on `body` and may hold a `var()` chain or a
   * `light-dark()` value, which an SVG presentation attribute cannot use.
   * Setting the token as `color` and reading the computed value resolves it
   * to a concrete color. The probe is created and removed per read, outside
   * any transcript node.
   * @returns {Record<string, string>} Mermaid theme variables.
   */
  const readThemeVariables = function readThemeVariables() {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    const variables = {};
    for (const [role, tokenName] of Object.entries(THEME_TOKEN_MAP)) {
      const fallback = FALLBACK_THEME_COLORS[role];
      // The fallback inside var() keeps the computed value a concrete color
      // even when the shell predates a token.
      probe.style.color = `var(${tokenName}, ${fallback})`;
      const computed = getComputedStyle(probe).color;
      variables[role] = computed.length === 0 ? fallback : computed;
    }
    probe.remove();
    return variables;
  };

  /**
   * Read the host's font stack for diagram text.
   * @returns {string} computed font family, or the fallback stack.
   */
  const readHostFontFamily = function readHostFontFamily() {
    const family = getComputedStyle(document.body).fontFamily;
    return family.length === 0 ? FALLBACK_FONT_FAMILY : family;
  };

  /**
   * Resolve everything a renderer needs from the current theme.
   *
   * Read once per theme change by the enhancer and passed to every render, so
   * a renderer never touches the DOM for colors and a second library gets the
   * same context without copying the probe.
   * @returns {{ themeVariables: Record<string, string>, fontFamily: string }} theme context.
   */
  const readThemeContext = function readThemeContext() {
    return Object.freeze({
      themeVariables: readThemeVariables(),
      fontFamily: readHostFontFamily(),
    });
  };

  /**
   * Resolve the SVG a `mermaid` fence describes.
   * @param {string} source - diagram source.
   * @param {{ themeVariables: Record<string, string>, fontFamily: string }} context - theme context.
   * @param {{ load: (logFailure: Function) => Promise<any> }} library - lazy script library.
   * @param {(message: string, error?: unknown) => void} logFailure - reporter.
   * @returns {Promise<{ svg: SVGSVGElement, renderId: string | null }>} unfinalized output.
   */
  const renderMermaidSvg = async function renderMermaidSvg(source, context, library, logFailure, runtime) {
    assertSafeDirectives(source);
    const mermaid = await library.load(logFailure);
    mermaid.initialize({
      startOnLoad: false,
      // Model output is untrusted: strict mode disables click handlers and
      // sanitizes labels, and HTML labels are disabled on top of that.
      securityLevel: 'strict',
      htmlLabels: false,
      // Failed parses are reported through our own fallback instead of
      // Mermaid injecting its own error graphic into the document.
      suppressErrorRendering: true,
      maxTextSize: MAX_MERMAID_SOURCE_CHARS,
      maxEdges: MAX_MERMAID_EDGES,
      theme: 'base',
      themeVariables: context.themeVariables,
      fontFamily: context.fontFamily,
      // The flowchart renderer reads its own subtree flag, so the global
      // `htmlLabels` alone is not enough to keep labels out of HTML.
      flowchart: { htmlLabels: false },
    });
    runtime.mermaidRenderId += 1;
    // Capture the id before awaiting: concurrent renders advance the counter,
    // and the stylesheet scope must be the id this render actually used.
    const renderId = `${MERMAID_ID_PREFIX}${runtime.mermaidRenderId}`;
    const result = await mermaid.render(renderId, source);
    const markup = typeof result === 'string' ? result : result?.svg;
    if (typeof markup !== 'string') throw new Error('visual-renderer: mermaid returned no markup');
    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    const svg = template.content.querySelector('svg');
    if (svg === null) throw new Error('visual-renderer: mermaid produced no <svg>');
    return { svg, renderId };
  };

  /**
   * Resolve the SVG an `svg` fence describes.
   *
   * Parsing happens in an inert `DOMParser` document, so nothing inside the
   * fence can execute or load while it is being read.
   * @param {string} source - fence source.
   * @returns {{ svg: SVGSVGElement, renderId: null }} unfinalized output.
   */
  const renderSvgFence = function renderSvgFence(source) {
    const document_ = new DOMParser().parseFromString(source, 'image/svg+xml');
    const parsed = document_.querySelector('parsererror') === null ? document_.documentElement : null;
    if (parsed !== null && parsed.localName === 'svg' && parsed.namespaceURI === SVG_NAMESPACE) {
      // Scrub in the inert document BEFORE importing into the live one: an
      // SVG image element adopted into a live document starts its fetch even
      // before insertion, so the removal has to happen first.
      sanitizeSvg(parsed, null);
      return { svg: document.importNode(parsed, true), renderId: null };
    }
    // A fence written without `xmlns` parses into the null namespace, where
    // SVG APIs such as `style` do not exist. The HTML parser builds the same
    // markup in the SVG namespace, so use it as the fallback instead of
    // publishing an inert element.
    const template = document.createElement('template');
    template.innerHTML = source.trim();
    const fallback = template.content.querySelector('svg');
    if (fallback === null) throw new Error('visual-renderer: svg fence has no <svg> root');
    // Template content is inert too; scrub before the element reaches a tree
    // that would resolve its references.
    sanitizeSvg(fallback, null);
    return { svg: fallback, renderId: null };
  };

  /**
   * Build one renderer descriptor.
   *
   * A descriptor owns everything that differs per diagram language: its
   * matcher, size budget, render path, label key and sizing rule. The
   * controller only calls `matches` and `render`, so adding a language
   * touches this table and the Host asset list, not the controller.
   * @param {object} descriptor - renderer fields.
   * @returns {Readonly<object>} frozen descriptor.
   */
  const defineRenderer = function defineRenderer(descriptor) {
    return Object.freeze({ aliases: [], authoredSize: false, ...descriptor });
  };

  /**
   * Build the renderer table.
   *
   * Order matters only for the unknown-language fallback: the first matching
   * renderer wins, and the Mermaid directive is the more specific shape.
   * @returns {ReadonlyArray<Readonly<object>>} renderers.
   */
  const createRenderers = function createRenderers(library, runtime) {
    return Object.freeze([
      defineRenderer({
        id: 'mermaid',
        aliases: ['mmd'],
        labelKey: 'label.mermaid',
        maxSourceChars: MAX_MERMAID_SOURCE_CHARS,
        matches: (source) => MERMAID_DIRECTIVE_PATTERN.test(firstDirectiveLine(source)),
        render: (source, context, logFailure) => renderMermaidSvg(source, context, library, logFailure, runtime),
      }),
      defineRenderer({
        id: 'svg',
        labelKey: 'label.svg',
        maxSourceChars: MAX_SVG_SOURCE_CHARS,
        authoredSize: true,
        matches: looksLikeSvgSource,
        render: (source) => Promise.resolve(renderSvgFence(source)),
      }),
    ]);
  };

  /**
   * Pick the renderer for one code block.
   *
   * A bare banner token is a real fence language: the shell substitutes a
   * localized title (words, not a token) for languages it cannot highlight.
   * So a token that names no renderer keeps the block as source, and only an
   * absent token falls back to source-shape matching.
   * @param {Element} wrapper - `.md-code-block` wrapper.
   * @param {string} source - fence source.
   * @param {ReadonlyArray<Readonly<object>>} renderers - renderer table.
   * @returns {Readonly<object> | null} matching renderer.
   */
  const classify = function classify(wrapper, source, renderers) {
    const bannerLanguage = readBannerLanguage(wrapper);
    if (bannerLanguage !== null) {
      return renderers.find((r) => r.id === bannerLanguage || r.aliases.includes(bannerLanguage)) ?? null;
    }
    for (const renderer of renderers) if (renderer.matches(source)) return renderer;
    return null;
  };

  /**
   * Own the figure DOM for one code block.
   *
   * The view is the only place that reads or hides host nodes, so figure
   * lifetime and source-visibility lifetime cannot drift apart.
   * @param {Element} wrapper - `.md-code-block` wrapper.
   * @param {(key: string) => string} t - translate function.
   * @returns {object} view with mount/destroy/refresh operations.
   */
  const createFigureView = function createFigureView(wrapper, t) {
    const figure = document.createElement('figure');
    figure.className = VISUAL_CLASS_PREFIX;
    figure.setAttribute(FIGURE_ATTRIBUTE, '');
    figure.dataset.dshVisualState = STATE_DIAGRAM;

    const toolbar = document.createElement('div');
    toolbar.className = `${VISUAL_CLASS_PREFIX}__toolbar`;
    const label = document.createElement('span');
    label.className = `${VISUAL_CLASS_PREFIX}__label`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `${VISUAL_CLASS_PREFIX}__toggle`;
    const canvas = document.createElement('div');
    canvas.className = `${VISUAL_CLASS_PREFIX}__canvas`;
    toolbar.append(label, toggle);
    figure.append(toolbar, canvas);

    /** @type {Readonly<object> | null} renderer currently drawn */
    let renderer = null;
    /** Whether the host source is shown instead of the drawing. */
    let sourceShown = false;

    /** Apply the one visibility rule to the host nodes this view supersedes. */
    function applyHostVisibility() {
      const banner = wrapper.querySelector(CODE_BLOCK_BANNER_SELECTOR);
      const content = wrapper.querySelector(CODE_BLOCK_CONTENT_SELECTOR);
      if (banner !== null) banner.classList.toggle(SOURCE_HIDDEN_CLASS, !sourceShown);
      if (content !== null) content.classList.toggle(SOURCE_HIDDEN_CLASS, !sourceShown);
    }

    /** Re-apply toolbar copy for the current locale and state. */
    function applyLabels() {
      label.textContent = translate(t, renderer?.labelKey ?? 'label.mermaid');
      toggle.textContent = translate(t, sourceShown ? 'action.diagram' : 'action.source');
      toggle.setAttribute('aria-pressed', sourceShown ? 'true' : 'false');
    }

    toggle.addEventListener('click', () => {
      sourceShown = !sourceShown;
      figure.dataset.dshVisualState = sourceShown ? STATE_SOURCE : STATE_DIAGRAM;
      applyHostVisibility();
      applyLabels();
    });

    return {
      /** Show a finalized drawing for one renderer. */
      mount(nextRenderer, svg) {
        renderer = nextRenderer;
        canvas.replaceChildren(svg);
        // `sourceShown` survives re-renders: a theme change or a streaming
        // revision must not yank the reader out of the source view.
        figure.dataset.dshVisualState = sourceShown ? STATE_SOURCE : STATE_DIAGRAM;
        applyLabels();
        if (!figure.isConnected) wrapper.append(figure);
        applyHostVisibility();
      },
      /** Remove the figure and restore the host source. */
      destroy() {
        figure.remove();
        // Without a drawing the host source must be visible: `sourceShown`
        // drives the same rule that the toggle uses, so set it before
        // applying visibility or the source would stay hidden.
        sourceShown = true;
        applyHostVisibility();
      },
      /** Whether the figure is still in the document. */
      isMounted() {
        return figure.isConnected;
      },
      /** Re-apply the host visibility rule after the host nodes were replaced. */
      syncHostVisibility() {
        if (figure.isConnected) applyHostVisibility();
      },
      /** Re-apply toolbar copy after a locale switch. */
      refreshLabels() {
        if (!figure.isConnected) return;
        applyLabels();
      },
    };
  };

  /**
   * One rendered-fence controller.
   *
   * The controller owns the render state machine for one code block: read source
   * → classify → render → finalize → mount, with one failure path that keeps
   * source visible. Replacement and clearing always go through `clearFigure`,
   * so no caller can forget a state field.
   * @param {object} env - t, renderers, theme-context reader and per-controller theme getter.
   * @param {Element} wrapper - `.md-code-block` wrapper.
   * @param {() => void} onDestroy - registry callback.
   * @returns {object} controller.
   */
  class FenceController {
    constructor(env, wrapper, onDestroy) {
      this.env = env;
      this.wrapper = wrapper;
      this.onDestroy = onDestroy;
      this.failure = createFailureReporter();
      this.view = null;
      this.renderedSource = null;
      this.renderedLanguage = null;
      this.renderTimer = 0;
      this.settleTimer = 0;
      this.visible = false;
      this.revision = 0;
      this.destroyed = false;
    }

    /**
     * Invalidate any in-flight render and forget the cached drawing.
     *
     * Bumping the revision is what makes an older pass discard its result:
     * without it an in-flight render started before a theme change can commit
     * old-theme output and repopulate the cache.
     */
    invalidateDrawing() {
      this.revision += 1;
      if (this.settleTimer !== 0) {
        clearTimeout(this.settleTimer);
        this.settleTimer = 0;
      }
      this.renderedSource = null;
      this.renderedLanguage = null;
    }

    /** Forget the drawing and restore the host source. */
    clearFigure() {
      this.invalidateDrawing();
      if (this.view !== null) {
        this.view.destroy();
        this.view = null;
      }
    }

    /** Debounce a render; streaming rewrites the fence repeatedly. */
    scheduleRender() {
      if (this.destroyed || this.renderTimer !== 0) return;
      this.renderTimer = globalThis.setTimeout(() => {
        this.renderTimer = 0;
        void this.renderNow();
      }, RENDER_DEBOUNCE_MS);
    }

    /** Report one rejected source revision, then fall back or wait it out. */
    onRenderFailure(source, error) {
      this.failure.report('render failed', error);
      const growing = this.renderedSource !== null && source.startsWith(this.renderedSource);
      if (this.view !== null && growing) {
        if (this.settleTimer !== 0) clearTimeout(this.settleTimer);
        this.settleTimer = globalThis.setTimeout(() => {
          this.settleTimer = 0;
          if (this.destroyed) return;
          const current = this.wrapper.querySelector(CODE_BLOCK_CONTENT_SELECTOR);
          if (current !== null && readSource(current) === source) this.clearFigure();
        }, INVALID_SETTLE_MS);
        return;
      }
      this.clearFigure();
    }

    /** Keep validation and cache reuse synchronous before starting library work. */
    readRenderRequest() {
      if (this.destroyed || !this.wrapper.isConnected) return null;
      // React can replace the content element in place; resolve it per pass
      // instead of holding the node captured at attach time.
      const content = this.wrapper.querySelector(CODE_BLOCK_CONTENT_SELECTOR);
      if (content === null) {
        this.clearFigure();
        return null;
      }
      const source = readSource(content);
      const candidate = classify(this.wrapper, source, this.env.renderers);
      if (candidate === null) {
        this.clearFigure();
        return null;
      }
      this.failure.setContext(candidate.id, source.length);
      if (source.length === 0) {
        this.clearFigure();
        return null;
      }
      if (!this.visible) return null;
      if (
        source === this.renderedSource && candidate.id === this.renderedLanguage && this.view !== null &&
        this.view.isMounted()
      ) {
        // React can replace the content element with an identical source; the
        // new node is visible beside the figure until the rule is re-applied.
        this.view.syncHostVisibility();
        return null;
      }
      if (source === this.renderedSource && candidate.id === this.renderedLanguage) {
        // The cache thinks a drawing exists but its figure is gone (for
        // example after React replaced the wrapper children): drop the view
        // and render again instead of leaving the host source hidden.
        this.view = null;
        this.renderedSource = null;
        this.renderedLanguage = null;
      }
      if (source.length > candidate.maxSourceChars) {
        this.failure.report(`source exceeds ${candidate.maxSourceChars} characters`);
        this.clearFigure();
        return null;
      }
      return { content, source, candidate };
    }

    /** Commit only the current revision, after the shared sanitizer accepts it. */
    async renderNow() {
      const request = this.readRenderRequest();
      if (request === null) return;
      const { content, source, candidate } = request;
      this.revision += 1;
      const attempt = this.revision;
      let svg;
      try {
        svg = await candidate.render(
          source,
          this.env.getThemeContext(),
          (message, error) => this.failure.report(message, error),
        );
      } catch (error) {
        if (this.destroyed || attempt !== this.revision) return;
        this.onRenderFailure(source, error);
        return;
      }
      // A newer revision or a detached block wins over this late result; the
      // newer pass owns the figure so the DOM never shows stale source.
      if (this.destroyed || attempt !== this.revision || !content.isConnected) return;
      if (readSource(content) !== source) {
        this.scheduleRender();
        return;
      }
      if (this.settleTimer !== 0) {
        clearTimeout(this.settleTimer);
        this.settleTimer = 0;
      }
      try {
        if (this.view === null) this.view = createFigureView(this.wrapper, this.env.t);
        this.view.mount(candidate, finalizeSvg(svg, candidate.authoredSize));
      } catch (error) {
        // A renderer output the DOM rejects must never hide the source: drop
        // whatever was mounted and report it once.
        this.clearFigure();
        this.failure.report('drawing could not be attached', error);
        return;
      }
      this.renderedSource = source;
      this.renderedLanguage = candidate.id;
      this.failure.reset();
    }

    /** Off-screen fences retain state without starting unnecessary renders. */
    setVisible(next) {
      this.visible = next;
      if (this.visible) this.scheduleRender();
    }

    /** Theme changes must invalidate pending work as well as cached output. */
    refreshTheme() {
      // Theme variables are baked into Mermaid output, so a theme change
      // invalidates the drawing and every in-flight render.
      this.invalidateDrawing();
      this.scheduleRender();
    }

    /** Locale refreshes must preserve the current source/diagram choice. */
    refreshLabels() {
      this.view?.refreshLabels();
    }

    /** Cancelling the timer prevents detached wrappers from starting new work. */
    destroy() {
      this.destroyed = true;
      if (this.renderTimer !== 0) {
        clearTimeout(this.renderTimer);
        this.renderTimer = 0;
      }
      this.clearFigure();
      this.onDestroy();
    }
  }

  /**
   * Build a per-controller failure reporter that logs once per distinct
   * message. Streaming revisits the same invalid revision many times; without
   * this the console would flood.
   * @returns {{ setContext: (id: string, sourceChars: number) => void, report: (message: string, error?: unknown) => void, reset: () => void }} reporter.
   */
  const createFailureReporter = function createFailureReporter() {
    let language = 'unknown';
    let sourceChars = 0;
    let reported = null;
    return {
      setContext(id, chars) {
        language = id;
        sourceChars = chars;
      },
      report(message, error) {
        if (reported === message) return;
        reported = message;
        const detail = error instanceof Error ? error.name : String(error);
        console.warn(`[visual-renderer] ${message} language=${language} sourceChars=${sourceChars} ${detail}`);
      },
      reset() {
        reported = null;
      },
    };
  };

  /**
   * Build the enhancer runtime.
   *
   * One instance owns every controller and observer created for the active
   * plugin row; its disposer detaches all of them and restores the host
   * markup. Mutations are routed to the wrapper that changed instead of
   * rescanning the transcript, and the plugin's own figure subtree is never
   * treated as input, so observer work stays bounded while a reply streams.
   * @param {object} env - t, renderers, theme-context reader and per-controller theme getter.
   * @returns {{ dispose: () => void, refreshLabels: () => void, refreshTheme: () => void }} lifetime.
   */
  class TranscriptEnhancer {
    constructor(env) {
      this.env = env;
      this.controllers = new Map();
      this.refreshTimer = 0;
      this.disposed = false;
      // Theme reads remain once per refresh, not once per drawing.
      this.themeContext = env.readThemeContext();
      installStyle(env.runtime);
      /** Viewport gate: a long transcript renders only what is near the view. */
      this.visibilityObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const controller = this.controllers.get(entry.target);
            if (controller !== undefined) controller.setVisible(entry.isIntersecting);
          }
        },
        { rootMargin: VISIBILITY_ROOT_MARGIN },
      );

      this.transcriptObserver = new MutationObserver((records) => this.onMutations(records));
      this.transcriptObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

      // Blocks that were already on screen before this plugin activated receive
      // no mutation, so the observer alone would never see them: scan once for
      // reloads and sessions restored from the sidebar.
      const scope = document.querySelector(CHAT_FLOW_SELECTOR);
      if (scope !== null) {
        for (const wrapper of scope.querySelectorAll(CODE_BLOCK_WRAPPER_SELECTOR)) {
          if (!this.controllers.has(wrapper) && wrapper.querySelector(CODE_BLOCK_CONTENT_SELECTOR) !== null) {
            this.attach(wrapper);
          }
        }
      }
    }

    /** Whether an element is inside the plugin's own figure DOM. */
    owned(element) {
      return element.closest(`[${FIGURE_ATTRIBUTE}]`) !== null;
    }

    /** Resolve the code block wrapper that owns a mutation target, if any. */
    wrapperOf(node) {
      const element = node instanceof Element ? node : node.parentElement;
      if (element === null || element === undefined || this.owned(element)) return null;
      if (element.matches(CODE_BLOCK_WRAPPER_SELECTOR)) return element;
      return element.closest(CODE_BLOCK_WRAPPER_SELECTOR);
    }

    /** Resolve every wrapper in a subtree that a mutation added. */
    wrappersWithin(node) {
      const element = node instanceof Element ? node : null;
      if (element === null || this.owned(element)) return [];
      const found = [];
      if (element.matches(CODE_BLOCK_WRAPPER_SELECTOR)) found.push(element);
      found.push(...element.querySelectorAll(CODE_BLOCK_WRAPPER_SELECTOR));
      return found.filter((wrapper) => wrapper.closest(CHAT_FLOW_SELECTOR) !== null);
    }

    /** Drop controllers whose wrapper left the document. */
    pruneDisconnected() {
      for (const [wrapper, controller] of this.controllers) {
        if (wrapper.isConnected) continue;
        this.visibilityObserver.unobserve(wrapper);
        controller.destroy();
      }
    }

    /**
     * Attach a controller to one wrapper and observe its visibility.
     * @param {Element} wrapper - `.md-code-block` wrapper.
     */
    attach(wrapper) {
      // The theme context changes over the enhancer's lifetime; controllers
      // read it through a getter instead of holding a stale copy.
      const controller = new FenceController(
        { ...this.env, getThemeContext: () => this.themeContext },
        wrapper,
        () => this.controllers.delete(wrapper),
      );
      this.controllers.set(wrapper, controller);
      this.visibilityObserver.observe(wrapper);
      controller.scheduleRender();
    }

    /** Handle one wrapper that a mutation touched. */
    touch(wrapper) {
      // Only transcript code blocks are in scope: the same Markdown component
      // renders in other surfaces (sidebar previews), and enhancing those is
      // neither requested nor safe to style with transcript rules.
      if (wrapper.closest(CHAT_FLOW_SELECTOR) === null) return;
      const controller = this.controllers.get(wrapper);
      if (controller !== undefined) {
        controller.scheduleRender();
        return;
      }
      if (wrapper.querySelector(CODE_BLOCK_CONTENT_SELECTOR) !== null) this.attach(wrapper);
    }

    /** Route transcript mutations to the affected wrappers only. */
    onMutations(records) {
      if (this.disposed) return;
      for (const record of records) {
        if (record.type === 'characterData') {
          const wrapper = this.wrapperOf(record.target);
          if (wrapper !== null) this.touch(wrapper);
          continue;
        }
        // The target itself can lose a child (a shrinking fence) without any
        // added node, so resolve it before walking the added/removed nodes.
        const targetWrapper = this.wrapperOf(record.target);
        if (targetWrapper !== null) this.touch(targetWrapper);
        // A plain, unhighlighted fence grows and shrinks by replacing text
        // nodes inside <code>, which are not Elements: resolve the owning
        // wrapper from the node itself before scanning for new wrappers.
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          const wrapper = this.wrapperOf(node);
          if (wrapper !== null) {
            this.touch(wrapper);
            continue;
          }
          for (const found of this.wrappersWithin(node)) this.touch(found);
        }
        // A removed subtree can take a tracked wrapper with it; prune on the
        // spot instead of waiting for the next unrelated mutation.
        if (record.removedNodes.length > 0) this.pruneDisconnected();
      }
    }

    /** Re-render every drawn figure after a theme change. */
    refreshTheme() {
      if (this.disposed || this.refreshTimer !== 0) return;
      this.refreshTimer = globalThis.setTimeout(() => {
        this.refreshTimer = 0;
        this.themeContext = this.env.readThemeContext();
        for (const controller of this.controllers.values()) controller.refreshTheme();
      }, REFRESH_DEBOUNCE_MS);
    }

    /** Re-apply toolbar copy after a locale switch. */
    refreshLabels() {
      for (const controller of this.controllers.values()) controller.refreshLabels();
    }

    /** Release observers before restoring host nodes to avoid self-mutations. */
    dispose() {
      this.disposed = true;
      this.transcriptObserver.disconnect();
      this.visibilityObserver.disconnect();
      if (this.refreshTimer !== 0) clearTimeout(this.refreshTimer);
      for (const [wrapper, controller] of [...this.controllers]) {
        this.visibilityObserver.unobserve(wrapper);
        controller.destroy();
      }
      this.controllers.clear();
      removeStyle(this.env.runtime);
    }
  }

  /**
   * Services the browser half needs. `locale` holds the toolbar copy, and
   * `theme` is the only supported continuous sync for palette changes: the
   * theme service re-emits `theme/change` for preference and OS-scheme flips,
   * so the plugin never observes theme DOM attributes on its own.
   */
  const inject = ['locale', 'theme'];

  /**
   * Register dictionaries, start the transcript enhancer, and follow theme
   * and locale changes through their services.
   * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
   */
  const apply = function apply(ctx, runtime) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'visual-renderer: dictionaries');
    const library = new SandboxedMermaidLibrary({
      path: MERMAID_ASSET_PATH,
    });
    const enhancer = new TranscriptEnhancer({
      runtime,
      t,
      renderers: createRenderers(library, runtime),
      readThemeContext,
    });
    ctx.effect(
      () => () => {
        enhancer.dispose();
        library.unload();
      },
      'visual-renderer: transcript enhancer',
    );
    ctx.effect(() => ctx.on('theme/change', () => enhancer.refreshTheme()), 'visual-renderer: theme refresh');
    ctx.effect(() => ctx.locale.subscribe(() => enhancer.refreshLabels()), 'visual-renderer: locale refresh');
  };

  globalThis.__ModuleLoader__.load({
    id: '@local/visual-renderer',
    factory() {
      // A factory invocation owns its counters and stylesheet, just as before;
      // reusable policy and methods stay isolated in the surrounding block.
      const runtime = { styleElement: null, mermaidRenderId: 0 };
      return { inject: [...inject], apply: (ctx) => apply(ctx, runtime) };
    },
  });
}
