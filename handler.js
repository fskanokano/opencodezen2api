import { createApp } from './src/proxy.js';
import { buildConfig, isScalewayFunctionEnv } from './src/config.js';
import { pathToFileURL } from 'url';

// Lazy singleton app for cold-start reuse
let cached = null;
let cachedConfig = null;

function getConfigFromEnv() {
    return buildConfig();
}

async function getApp() {
    if (cached && cachedConfig) return cached;
    const config = getConfigFromEnv();
    cachedConfig = config;
    const { app } = createApp(config);
    cached = app;
    // Warm backend asynchronously but don't block first request beyond health check
    // ensureBackend is called lazily inside proxy handlers when needed.
    return app;
}

// Adapt Scaleway event to Node http for serverless-http
// Scaleway sends: { httpMethod, path, headers, body, queryStringParameters, isBase64Encoded }
// serverless-http expects AWS-like event; we normalize here without external dep first,
// then use a tiny manual adapter to avoid adding heavy dependency if not needed.
// However we use serverless-http if available for full Express compatibility.

let serverlessHttpHandler = null;

async function getServerlessHandler() {
    if (serverlessHttpHandler) return serverlessHttpHandler;
    const app = await getApp();
    try {
        const { default: serverless } = await import('serverless-http');
        serverlessHttpHandler = serverless(app, {
            binary: ['image/*', 'application/octet-stream'],
            request: (req, event) => {
                // Preserve original Scaleway context if needed
                req.scalewayEvent = event;
                req.scalewayContext = event.requestContext;
            }
        });
    } catch (e) {
        // Fallback: manual adapter using supertest-like simulation if serverless-http missing
        console.warn('[Handler] serverless-http not found, using fallback adapter:', e.message);
        serverlessHttpHandler = async (event, context) => {
            // Fallback: create minimal HTTP response via app.handle
            return new Promise((resolve) => {
                const headers = event.headers || {};
                const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
                const path = event.path || event.rawPath || '/';
                const qs = event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : '';
                const url = path + qs;
                const body = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString() : (event.body || '');

                // Create mock req/res using Node's http IncomingMessage/ServerResponse isn't trivial.
                // Instead return 500 with instruction to install serverless-http.
                resolve({
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: {
                            message: 'Missing dependency serverless-http. Run npm install serverless-http and repack.',
                            type: 'missing_dependency',
                            hint: 'npm install serverless-http @scaleway/serverless-functions'
                        }
                    })
                });
            });
        };
    }
    return serverlessHttpHandler;
}

function normalizeScalewayEvent(event) {
    if (!event) return event;
    // Already AWS-like
    if (event.httpMethod && event.path) return event;
    // Scaleway may send body as object already parsed? Ensure string
    if (event.body && typeof event.body !== 'string') {
        try { event.body = JSON.stringify(event.body); } catch (_) { }
    }
    // Handle alternative shapes: rawPath + requestContext.http.method
    if (!event.httpMethod && event.requestContext?.http?.method) {
        event.httpMethod = event.requestContext.http.method;
    }
    if (!event.path && event.rawPath) {
        event.path = event.rawPath;
    }
    if (!event.headers) event.headers = {};
    // Lowercase header keys handled by serverless-http, keep original
    return event;
}

/**
 * Scaleway Functions handler
 * Signature: handle(event, context, callback) -> { statusCode, headers, body }
 * Supports both async return and callback style.
 */
export async function handle(event, context, callback) {
    const start = Date.now();
    const normalized = normalizeScalewayEvent(event);

    // Light logging for cold start
    if (process.env.DEBUG === 'true' || process.env.OPENCODE_PROXY_DEBUG === 'true') {
        console.log('[Handler] Event:', JSON.stringify({ httpMethod: normalized.httpMethod, path: normalized.path, headers: Object.keys(normalized.headers || {}) }));
    }

    try {
        const handler = await getServerlessHandler();
        const response = await handler(normalized, context);

        // Ensure headers exist and add scaleway-friendly CORS if missing
        if (!response.headers) response.headers = {};
        if (!response.headers['X-Proxy-Handler']) {
            response.headers['X-Proxy-Handler'] = 'scaleway-function';
            response.headers['X-Cold-Start'] = cached ? 'warm' : 'cold';
            response.headers['X-Duration-Ms'] = String(Date.now() - start);
        }

        // Scaleway expects body as string; ensure
        if (response.body && typeof response.body !== 'string') {
            response.body = JSON.stringify(response.body);
        }

        if (typeof callback === 'function') {
            callback(null, response);
            return;
        }
        return response;
    } catch (err) {
        console.error('[Handler] Fatal:', err);
        const errorResponse = {
            statusCode: err.statusCode || 500,
            headers: { 'Content-Type': 'application/json', 'X-Error': 'handler' },
            body: JSON.stringify({
                error: {
                    message: err.message || 'Internal server error',
                    type: err.type || 'internal_error',
                    code: err.code || 'handler_error'
                }
            })
        };
        if (typeof callback === 'function') {
            callback(null, errorResponse);
            return;
        }
        return errorResponse;
    }
}

// For local testing with @scaleway/serverless-functions
let isMain = false;
try {
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) isMain = true;
} catch (_) {}
if (isMain) {
    const port = parseInt(process.env.PORT) || 8080;
    console.log(`[Handler] Local test mode on :${port} (Scaleway emulation)`);
    import('@scaleway/serverless-functions').then(m => {
        m.serveHandler(handle, port);
    }).catch(() => {
        // fallback to express direct
        console.log('[Handler] @scaleway/serverless-functions not installed, starting Express directly');
        getApp().then(app => {
            app.listen(port, '0.0.0.0', () => console.log(`[Handler] Listening http://0.0.0.0:${port}`));
        });
    });
}
