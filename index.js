/**
 * Host half of the transcript visual renderer.
 *
 * The browser half needs the Mermaid library, but the client bundle system has
 * no route for arbitrary package files: it serves only the declared client
 * bundle and image assets. The library is also far too large to load eagerly
 * for sessions that never draw a diagram. This half therefore owns one exact,
 * read-only HTTP route that streams the pinned library on first use, so the
 * browser pays for it only when a diagram actually appears.
 *
 * The route is deliberately not configurable: one fixed pathname, one fixed
 * file inside this package. There is no user input in the path, so no traversal
 * surface and no way for a request to read any other file.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/**
 * Fixed assets the browser half may request. Each entry is an exact route with
 * one fixed file: no request input reaches the filesystem, so a later renderer
 * adds one allowlisted row instead of a second handler.
 */
const ASSETS = Object.freeze([
  Object.freeze({
    route: '/dsh-visual-assets/mermaid.min.js',
    file: 'mermaid/dist/mermaid.min.js',
    contentType: 'text/javascript; charset=utf-8',
  }),
]);

/** Package resolution stays anchored to this bundle, never to request input. */
const resolveAsset = createRequire(import.meta.url).resolve;

/**
 * Fixed route, mutable bytes: a package update must be able to replace the
 * library at the same URL. `no-cache` forces a conditional request, which the
 * strong ETag below answers with a 304 when the bytes are unchanged; local
 * revalidation is cheap and avoids pinning a stale build in the browser cache.
 */
const ASSET_CACHE_CONTROL = 'no-cache';

/** Methods the route answers; anything else is a client error, not a fallback. */
const ASSET_METHODS = new Set(['GET', 'HEAD']);

/** Prefix for diagnostics, so a log line names the plugin that failed. */
const LOG_PREFIX = '[visual-renderer]';

/** Services the host half needs; without a web server both halves stay inert. */
export const inject = ['webServer'];

/**
 * Serve the pinned Mermaid runtime.
 *
 * The file is read lazily at the first request and cached for the lifetime of
 * this plugin row: reading several megabytes on every diagram would stall the
 * page, while the file cannot change without a package reinstall that restarts
 * the row. A read failure is cached as no failure state so a transient disk
 * error can recover on the next request.
 * @param {import('node:http').IncomingMessage} request - browser request.
 * @param {import('node:http').ServerResponse} response - response to fill.
 * @param {() => Promise<{ bytes: Buffer, etag: string }>} loadAsset - cached loader.
 * @param {{ error: (message: string, error?: unknown) => void }} logger - host logger.
 */
async function serveAsset(request, response, asset, loadAsset, logger) {
  const method = request.method ?? 'GET';
  if (!ASSET_METHODS.has(method)) {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }
  let loaded;
  try {
    loaded = await loadAsset();
  } catch (error) {
    // Fail closed: a broken install must not answer with an empty 200 that the
    // browser would cache as a valid script.
    logger.error(`${LOG_PREFIX} asset read failed path=${asset.file}`, error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('visual-renderer: asset unavailable\n');
    return;
  }
  if (request.headers['if-none-match'] === loaded.etag) {
    response.writeHead(304, { etag: loaded.etag, 'cache-control': ASSET_CACHE_CONTROL });
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': String(loaded.bytes.byteLength),
    'cache-control': ASSET_CACHE_CONTROL,
    etag: loaded.etag,
    // A script must never be sniffed into another type: this route is the only
    // executable surface the plugin adds to the host.
    'x-content-type-options': 'nosniff',
  });
  response.end(method === 'HEAD' ? undefined : loaded.bytes);
}

/**
 * Register the asset route for this plugin row.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  const logger = {
    error: (message, error) => {
      if (typeof ctx.logger?.error === 'function') ctx.logger.error(message, error);
      else console.error(message, error);
    },
  };

  for (const asset of ASSETS) {
    /** @type {Promise<{ bytes: Buffer, etag: string }> | null} */
    let assetPromise = null;

    const loadAsset = () => {
      if (assetPromise === null) {
        assetPromise = Promise.resolve()
          .then(() => readFile(resolveAsset(asset.file)))
          .then((bytes) => ({
            bytes,
            etag: `"${createHash('sha256').update(bytes).digest('base64url')}"`,
          }))
          .catch((error) => {
            // Forget the rejected promise so a later request retries instead of
            // replaying a transient read failure forever.
            assetPromise = null;
            throw error;
          });
      }
      return assetPromise;
    };

    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: asset.route,
          handler: (request, response) => {
            serveAsset(request, response, asset, loadAsset, logger).catch((error) => {
              logger.error(`${LOG_PREFIX} route handler failed path=${asset.route}`, error);
              if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
              if (!response.writableEnded) response.end();
            });
          },
        }),
      `visual-renderer: asset route ${asset.route}`,
    );
  }
}
