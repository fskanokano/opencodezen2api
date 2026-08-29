import { buildConfig } from './src/config.js';
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
    const { createApp } = await import('./src/proxy.js');
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
async function directZenProxy(event) {
    const zenKey = process.env.OPENCODE_ZEN_API_KEY || 'public';
    const method = (event.httpMethod || 'GET').toUpperCase();
    const path = event.path || '/';
    const isModels = path === '/v1/models' && method === 'GET';
    const isHealth = (path === '/health' || path === '/' ) && method === 'GET';
    const isChat = path === '/v1/chat/completions' && method === 'POST';
    const isResponses = path === '/v1/responses' && method === 'POST';
    const isMessages = path === '/v1/messages' && method === 'POST';
    if (isHealth) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'X-Proxy-Mode': 'direct-zen' },
            body: JSON.stringify({ status: 'ok', proxy: true, mode: 'direct-zen', zen: !!process.env.OPENCODE_ZEN_API_KEY })
        };
    }
    // 只对已知路径做直连，其它回退 404
    let upstreamPath = null;
    if (isChat) upstreamPath = '/zen/v1/chat/completions';
    else if (isResponses) upstreamPath = '/zen/v1/responses';
    else if (isMessages) upstreamPath = '/zen/v1/messages';
    else if (isModels) upstreamPath = '/zen/v1/models';
    else return null;

    const upstreamUrl = `https://opencode.ai${upstreamPath}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${zenKey}` };
    const opts = { method, headers };
    if (method === 'POST' && event.body) {
        let body = event.body;
        if (event.isBase64Encoded) {
            try { body = Buffer.from(body, 'base64').toString(); } catch (_) {}
        }
        // 尝试 JSON 解析以做最小清洗（去除客户端的 Authorization 干扰）
        try {
            const j = JSON.parse(body);
            // 若客户端传了自定义 model，保留；否则不改
            body = JSON.stringify(j);
        } catch (_) {}
        opts.body = body;
    }
    try {
        const resp = await fetch(upstreamUrl, opts);
        const text = await resp.text();
        // 透传上游状态与 body
        return {
            statusCode: resp.status,
            headers: {
                'Content-Type': resp.headers.get('content-type') || 'application/json',
                'X-Proxy-Mode': 'direct-zen'
            },
            body: text
        };
    } catch (e) {
        return {
            statusCode: 502,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: { message: `Direct Zen failed: ${e.message}`, type: 'zen_direct_error' } })
        };
    }
}

export async function handle(event, context, callback) {
    const start = Date.now();
    const normalized = normalizeScalewayEvent(event);

    // Light logging for cold start
    if (process.env.DEBUG === 'true' || process.env.OPENCODE_PROXY_DEBUG === 'true') {
        console.log('[Handler] Event:', JSON.stringify({ httpMethod: normalized.httpMethod, path: normalized.path, headers: Object.keys(normalized.headers || {}) }));
    }

    try {
        // 默认直连 Zen（后台管理已关闭），避免冷启动拉起 opencode
        const manageBackendEnv = String(process.env.OPENCODE_PROXY_MANAGE_BACKEND || '').toLowerCase().trim();
        const shouldDirect = !['true','1','yes','y','on'].includes(manageBackendEnv);
        if (shouldDirect) {
            const direct = await directZenProxy(normalized);
            if (direct) {
                if (!direct.headers['X-Proxy-Handler']) {
                    direct.headers['X-Proxy-Handler'] = 'scaleway-function';
                    direct.headers['X-Mode'] = 'direct-zen';
                    direct.headers['X-Duration-Ms'] = String(Date.now() - start);
                }
                if (direct.body && typeof direct.body !== 'string') direct.body = JSON.stringify(direct.body);
                if (typeof callback === 'function') { callback(null, direct); return; }
                return direct;
            }
        }
        const handler = await getServerlessHandler();
        let response = await handler(normalized, context);
        // 若后端不可用（MANAGE_BACKEND=false 且无外部 backend），回退直连
        const isBackendUnavailable = response.statusCode === 502 && typeof response.body === 'string' && response.body.includes('backend_unavailable');
        if (isBackendUnavailable) {
            const direct = await directZenProxy(normalized);
            if (direct) {
                if (!direct.headers['X-Proxy-Handler']) {
                    direct.headers['X-Proxy-Handler'] = 'scaleway-function';
                    direct.headers['X-Mode'] = 'direct-zen-fallback';
                    direct.headers['X-Duration-Ms'] = String(Date.now() - start);
                }
                if (typeof callback === 'function') { callback(null, direct); return; }
                return direct;
            }
        }

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
