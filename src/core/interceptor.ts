/**
 * Core interceptor: patches BOTH globalThis.fetch AND https.request.
 *
 * Why both?
 *  - globalThis.fetch  → modern SDKs in Node v18+, browser-targeted libs
 *  - https.request     → node-fetch v2, axios, got, and any SDK that ships
 *                        its own HTTP transport (e.g. OpenAI SDK v4)
 */

import https from 'node:https';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { detectService } from './registry.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type OriginalFetch = typeof globalThis.fetch;
type HttpsRequestFn = typeof https.request;
type HttpRequestFn = typeof http.request;

// ─── State ────────────────────────────────────────────────────────────────────

let originalFetch: OriginalFetch | null = null;
let originalHttpsRequest: HttpsRequestFn | null = null;
let originalHttpRequest: HttpRequestFn | null = null;
let enabled = false;

// ─── Mock IncomingMessage builder ────────────────────────────────────────────

function buildMockIncomingMessage(
  statusCode: number,
  rawHeaders: Record<string, string>,
  body: Buffer
): http.IncomingMessage {
  const readable = new Readable({
    read() {
      this.push(body);
      this.push(null);
    },
  });

  Object.assign(readable, {
    statusCode,
    statusMessage: 'OK',
    headers: rawHeaders,
    rawHeaders: Object.entries(rawHeaders).flat(),
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    trailers: {},
    socket: null,
    connection: null,
  });

  return readable as unknown as http.IncomingMessage;
}

// ─── Mock ClientRequest ──────────────────────────────────────────────────────

class MockClientRequest extends EventEmitter {
  private _chunks: Buffer[] = [];

  constructor(
    private readonly url: string,
    private readonly method: string,
    private readonly requestHeaders: Record<string, string>,
    private readonly callback?: (res: http.IncomingMessage) => void
  ) {
    super();
    // Emit a fake socket immediately so libraries like axios/follow-redirects
    // that listen for 'socket' on the request object get a valid EventEmitter.
    setImmediate(() => {
      const fakeSocket = Object.assign(new EventEmitter(), {
        setKeepAlive() {},
        setNoDelay() {},
        setTimeout() {},
        destroy() {},
        writable: true,
        encrypted: true,
      });
      this.emit('socket', fakeSocket);
    });
  }

  write(chunk: Buffer | string, _encoding?: BufferEncoding | (() => void), cb?: () => void): boolean {
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    if (typeof cb === 'function') cb();
    return true;
  }

  end(data?: Buffer | string | (() => void), _encoding?: BufferEncoding | (() => void), cb?: () => void): this {
    if (typeof data !== 'function' && data != null) {
      this._chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as string));
    }
    if (typeof cb === 'function') cb();

    // Fire async so the caller has time to attach event listeners
    setImmediate(() => void this._dispatch());
    return this;
  }

  private async _dispatch(): Promise<void> {
    const bodyText = Buffer.concat(this._chunks).toString('utf-8');
    const handler = detectService(this.url);

    if (!handler) {
      this.emit('error', new Error(`[devmock] No handler found for ${this.url}`));
      return;
    }

    try {
      const fetchResponse = await handler.handleFetch(this.url, {
        method: this.method,
        headers: this.requestHeaders,
        body: bodyText || undefined,
      });

      const bodyBuf = Buffer.from(await fetchResponse.arrayBuffer());
      const headersObj: Record<string, string> = {};
      fetchResponse.headers.forEach((v, k) => {
        headersObj[k] = v;
      });

      const mockRes = buildMockIncomingMessage(fetchResponse.status, headersObj, bodyBuf);

      if (this.callback) this.callback(mockRes);
      this.emit('response', mockRes);
    } catch (err) {
      this.emit('error', err);
    }
  }

  // Stub methods node-fetch calls on the request object
  setHeader(_name: string, _value: string): this { return this; }
  getHeader(_name: string): string | undefined { return undefined; }
  removeHeader(_name: string): this { return this; }
  flushHeaders(): void {}
  setTimeout(_ms: number, _cb?: () => void): this { return this; }
  destroy(_err?: Error): this { return this; }
  abort(): void {}
  get writable() { return true; }
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function optsToUrl(options: string | URL | http.RequestOptions): string | null {
  if (typeof options === 'string') return options;
  if (options instanceof URL) return options.href;
  const host = (options as http.RequestOptions).hostname ?? (options as http.RequestOptions).host ?? '';
  const port = (options as http.RequestOptions).port ? `:${(options as http.RequestOptions).port}` : '';
  const path = (options as http.RequestOptions).path ?? '/';
  const proto = 'https';
  return `${proto}://${host}${port}${path}`;
}

function optsToHeaders(options: string | URL | http.RequestOptions): Record<string, string> {
  if (typeof options === 'string' || options instanceof URL) return {};
  const h = (options as http.RequestOptions).headers ?? {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v != null) result[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return result;
}

function optsToMethod(options: string | URL | http.RequestOptions): string {
  if (typeof options === 'string' || options instanceof URL) return 'GET';
  return (options as http.RequestOptions).method ?? 'GET';
}

// ─── Patched https.request ────────────────────────────────────────────────────

function patchedHttpsRequest(
  options: string | URL | https.RequestOptions,
  callbackOrOptions?: ((res: http.IncomingMessage) => void) | https.RequestOptions,
  maybeCallback?: (res: http.IncomingMessage) => void
): http.ClientRequest {
  // Handle overloaded signatures: (options, callback?) and (url, options?, callback?)
  let callback: ((res: http.IncomingMessage) => void) | undefined;
  let resolvedOptions: string | URL | https.RequestOptions = options;

  if (typeof callbackOrOptions === 'function') {
    callback = callbackOrOptions;
  } else if (callbackOrOptions != null) {
    resolvedOptions = callbackOrOptions as https.RequestOptions;
    callback = maybeCallback;
  }

  const url = optsToUrl(resolvedOptions as http.RequestOptions);
  if (url) {
    const handler = detectService(url);
    if (handler) {
      return new MockClientRequest(
        url,
        optsToMethod(resolvedOptions as http.RequestOptions),
        optsToHeaders(resolvedOptions as http.RequestOptions),
        callback
      ) as unknown as http.ClientRequest;
    }
  }

  // Not a known service - use real https.request
  return originalHttpsRequest!(options as string, callbackOrOptions as (res: http.IncomingMessage) => void, maybeCallback);
}

// ─── Patched globalThis.fetch ─────────────────────────────────────────────────

async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const handler = detectService(url);
  if (handler) return handler.handleFetch(url, init);
  return originalFetch!(input, init);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function enableInterceptor(): void {
  if (enabled) return;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[devmock] Attempted to enable mocks in production! ' +
      'Set NODE_ENV to "development" or "test".'
    );
  }

  // Patch globalThis.fetch (modern SDKs)
  originalFetch = globalThis.fetch;
  // @ts-expect-error intentional monkey-patch
  globalThis.fetch = patchedFetch;

  // Patch https.request (node-fetch v2, axios, etc.)
  originalHttpsRequest = https.request;
  // @ts-expect-error intentional monkey-patch
  https.request = patchedHttpsRequest;

  // Also patch https.get (convenience wrapper that calls https.request)
  const originalGet = https.get;
  (https as typeof https & { _originalGet?: typeof https.get })._ = originalGet;
  https.get = function(options: any, callback?: any) {
    const req = patchedHttpsRequest(options, callback);
    req.end();
    return req;
  } as typeof https.get;

  enabled = true;
}

export function disableInterceptor(): void {
  if (!enabled) return;

  if (originalFetch) {
    // @ts-expect-error restoring
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }

  if (originalHttpsRequest) {
    // @ts-expect-error restoring
    https.request = originalHttpsRequest;
    originalHttpsRequest = null;
  }

  if (originalHttpRequest) {
    // @ts-expect-error restoring
    http.request = originalHttpRequest;
    originalHttpRequest = null;
  }

  enabled = false;
}

export function isEnabled(): boolean {
  return enabled;
}
