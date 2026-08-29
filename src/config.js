import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

function parseBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    }
    if (value === undefined || value === null) return fallback;
    return Boolean(value);
}

function parseToolAllowlist(value, fallback = []) {
    if (Array.isArray(value)) {
        return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
    }
    if (typeof value === 'string') {
        return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
    }
    if (value === undefined || value === null || value === '') return fallback;
    return fallback;
}

export function isScalewayFunctionEnv() {
    return Boolean(
        process.env.SCW_FUNCTION_NAME ||
        process.env.SCW_FUNCTION_ID ||
        process.env.SCW_EXECUTION_ENV ||
        process.env.SCALEWAY_FUNCTION ||
        process.env.FUNCTION_NAME ||
        (process.env.SCALEWAY_REGION && process.env.SCALEWAY_PROJECT_ID && process.env.PORT === '8080')
    );
}

export function buildConfig(overrides = {}) {
    const defaultConfig = {
        PORT: parseInt(process.env.OPENCODE_PROXY_PORT) || 10000,
        API_KEY: '',
        OPENCODE_SERVER_URL: `http://127.0.0.1:${process.env.OPENCODE_SERVER_PORT || 10001}`,
        OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
        // 默认关闭后台管理（用户明确不需要），Scaleway 下更是强制关闭
        MANAGE_BACKEND: false,
        OPENCODE_PATH: 'opencode',
        BIND_HOST: '0.0.0.0',
        DISABLE_TOOLS: true,
        EXTERNAL_TOOLS_MODE: 'proxy-bridge',
        EXTERNAL_TOOLS_CONFLICT_POLICY: 'namespace',
        INTERNAL_WEB_FETCH_ENABLED: parseBool(process.env.OPENCODE_INTERNAL_WEB_FETCH_ENABLED, false),
        INTERNAL_ALLOWED_TOOLS: parseToolAllowlist(process.env.OPENCODE_INTERNAL_ALLOWED_TOOLS, []),
        INTERNAL_TOOL_METRICS_ENABLED: parseBool(process.env.OPENCODE_INTERNAL_TOOL_METRICS_ENABLED, true),
        INTERNAL_TOOL_DISCOVERY_FIXTURE: parseToolAllowlist(process.env.OPENCODE_TOOL_DISCOVERY_FIXTURE, []),
        HEALTH_DETAILS_ENABLED: parseBool(process.env.OPENCODE_HEALTH_DETAILS_ENABLED, true),
        HEALTH_DETAILS_REQUIRE_AUTH: parseBool(process.env.OPENCODE_HEALTH_DETAILS_REQUIRE_AUTH, true),
        METRICS_ENABLED: parseBool(process.env.OPENCODE_METRICS_ENABLED, false),
        METRICS_REQUIRE_AUTH: parseBool(process.env.OPENCODE_METRICS_REQUIRE_AUTH, true),
        PROMPT_MODE: process.env.OPENCODE_PROXY_PROMPT_MODE || 'standard',
        OMIT_SYSTEM_PROMPT: parseBool(process.env.OPENCODE_PROXY_OMIT_SYSTEM_PROMPT, false),
        AUTO_CLEANUP_CONVERSATIONS: parseBool(process.env.OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS, false),
        CLEANUP_INTERVAL_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_INTERVAL_MS) || 43200000,
        CLEANUP_MAX_AGE_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_MAX_AGE_MS) || 86400000
    };

    const configPath = path.join(ROOT_DIR, 'config.json');
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err) {
            console.error('[Config] Error parsing config.json:', err.message);
        }
    }

    const ov = (k, envVal, fileVal, def) => {
        const o = overrides[k];
        if (o !== undefined && o !== null) return o;
        if (envVal !== undefined && envVal !== null && envVal !== '') return envVal;
        if (fileVal !== undefined && fileVal !== null && fileVal !== '') return fileVal;
        return def;
    };
    const finalConfig = {
        PORT: (() => {
            const o = overrides.PORT;
            if (o !== undefined && o !== null) return o;
            return parseInt(process.env.OPENCODE_PROXY_PORT) || parseInt(process.env.PORT) || fileConfig.PORT || defaultConfig.PORT;
        })(),
        API_KEY: ov('API_KEY', process.env.API_KEY, fileConfig.API_KEY, defaultConfig.API_KEY),
        OPENCODE_SERVER_URL: ov('OPENCODE_SERVER_URL', process.env.OPENCODE_SERVER_URL, fileConfig.OPENCODE_SERVER_URL, defaultConfig.OPENCODE_SERVER_URL),
        OPENCODE_SERVER_PASSWORD: ov('OPENCODE_SERVER_PASSWORD', process.env.OPENCODE_SERVER_PASSWORD, fileConfig.OPENCODE_SERVER_PASSWORD, defaultConfig.OPENCODE_SERVER_PASSWORD),
        MANAGE_BACKEND: (() => {
            const o = overrides.MANAGE_BACKEND;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_PROXY_MANAGE_BACKEND, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.MANAGE_BACKEND, undefined);
            if (f !== undefined) return f;
            return defaultConfig.MANAGE_BACKEND;
        })(),
        OPENCODE_PATH: ov('OPENCODE_PATH', process.env.OPENCODE_PATH, fileConfig.OPENCODE_PATH, defaultConfig.OPENCODE_PATH),
        BIND_HOST: ov('BIND_HOST', process.env.BIND_HOST, fileConfig.BIND_HOST, defaultConfig.BIND_HOST),
        DISABLE_TOOLS: (() => {
            const o = overrides.DISABLE_TOOLS;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_DISABLE_TOOLS, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.DISABLE_TOOLS, undefined);
            if (f !== undefined) return f;
            return defaultConfig.DISABLE_TOOLS;
        })(),
        EXTERNAL_TOOLS_MODE: ov('EXTERNAL_TOOLS_MODE', process.env.OPENCODE_EXTERNAL_TOOLS_MODE, fileConfig.EXTERNAL_TOOLS_MODE, defaultConfig.EXTERNAL_TOOLS_MODE),
        EXTERNAL_TOOLS_CONFLICT_POLICY: ov('EXTERNAL_TOOLS_CONFLICT_POLICY', process.env.OPENCODE_EXTERNAL_TOOLS_CONFLICT_POLICY, fileConfig.EXTERNAL_TOOLS_CONFLICT_POLICY, defaultConfig.EXTERNAL_TOOLS_CONFLICT_POLICY),
        INTERNAL_WEB_FETCH_ENABLED: (() => {
            const o = overrides.INTERNAL_WEB_FETCH_ENABLED;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_INTERNAL_WEB_FETCH_ENABLED, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.INTERNAL_WEB_FETCH_ENABLED, undefined);
            if (f !== undefined) return f;
            return defaultConfig.INTERNAL_WEB_FETCH_ENABLED;
        })(),
        INTERNAL_ALLOWED_TOOLS: (() => {
            const o = overrides.INTERNAL_ALLOWED_TOOLS;
            if (o !== undefined && o !== null) return parseToolAllowlist(o, []);
            if (process.env.OPENCODE_INTERNAL_ALLOWED_TOOLS !== undefined) return parseToolAllowlist(process.env.OPENCODE_INTERNAL_ALLOWED_TOOLS, []);
            if (fileConfig.INTERNAL_ALLOWED_TOOLS !== undefined) return parseToolAllowlist(fileConfig.INTERNAL_ALLOWED_TOOLS, []);
            return defaultConfig.INTERNAL_ALLOWED_TOOLS;
        })(),
        INTERNAL_TOOL_METRICS_ENABLED: (() => {
            const o = overrides.INTERNAL_TOOL_METRICS_ENABLED;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_INTERNAL_TOOL_METRICS_ENABLED, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.INTERNAL_TOOL_METRICS_ENABLED, undefined);
            if (f !== undefined) return f;
            return defaultConfig.INTERNAL_TOOL_METRICS_ENABLED;
        })(),
        INTERNAL_TOOL_DISCOVERY_FIXTURE: (() => {
            const o = overrides.INTERNAL_TOOL_DISCOVERY_FIXTURE;
            if (o !== undefined && o !== null) return parseToolAllowlist(o, []);
            if (process.env.OPENCODE_TOOL_DISCOVERY_FIXTURE !== undefined) return parseToolAllowlist(process.env.OPENCODE_TOOL_DISCOVERY_FIXTURE, []);
            if (fileConfig.INTERNAL_TOOL_DISCOVERY_FIXTURE !== undefined) return parseToolAllowlist(fileConfig.INTERNAL_TOOL_DISCOVERY_FIXTURE, []);
            return defaultConfig.INTERNAL_TOOL_DISCOVERY_FIXTURE;
        })(),
        HEALTH_DETAILS_ENABLED: (() => {
            const o = overrides.HEALTH_DETAILS_ENABLED;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_HEALTH_DETAILS_ENABLED, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.HEALTH_DETAILS_ENABLED, undefined);
            if (f !== undefined) return f;
            return defaultConfig.HEALTH_DETAILS_ENABLED;
        })(),
        HEALTH_DETAILS_REQUIRE_AUTH: (() => {
            const o = overrides.HEALTH_DETAILS_REQUIRE_AUTH;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_HEALTH_DETAILS_REQUIRE_AUTH, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.HEALTH_DETAILS_REQUIRE_AUTH, undefined);
            if (f !== undefined) return f;
            return defaultConfig.HEALTH_DETAILS_REQUIRE_AUTH;
        })(),
        METRICS_ENABLED: (() => {
            const o = overrides.METRICS_ENABLED;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_METRICS_ENABLED, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.METRICS_ENABLED, undefined);
            if (f !== undefined) return f;
            return defaultConfig.METRICS_ENABLED;
        })(),
        METRICS_REQUIRE_AUTH: (() => {
            const o = overrides.METRICS_REQUIRE_AUTH;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_METRICS_REQUIRE_AUTH, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.METRICS_REQUIRE_AUTH, undefined);
            if (f !== undefined) return f;
            return defaultConfig.METRICS_REQUIRE_AUTH;
        })(),
        USE_ISOLATED_HOME: (() => {
            const o = overrides.USE_ISOLATED_HOME;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_USE_ISOLATED_HOME, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.USE_ISOLATED_HOME, undefined);
            if (f !== undefined) return f;
            return false;
        })(),
        REQUEST_TIMEOUT_MS: (() => {
            const o = overrides.REQUEST_TIMEOUT_MS;
            if (o !== undefined && o !== null) return o;
            const e = parseInt(process.env.OPENCODE_PROXY_REQUEST_TIMEOUT_MS);
            if (!isNaN(e) && e) return e;
            if (fileConfig.REQUEST_TIMEOUT_MS) return fileConfig.REQUEST_TIMEOUT_MS;
            return 180000;
        })(),
        DEBUG: (() => {
            const o = overrides.DEBUG;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_PROXY_DEBUG, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.DEBUG, undefined);
            if (f !== undefined) return f;
            return false;
        })(),
        ZEN_API_KEY: ov('ZEN_API_KEY', process.env.OPENCODE_ZEN_API_KEY, fileConfig.ZEN_API_KEY, ''),
        PROMPT_MODE: ov('PROMPT_MODE', process.env.OPENCODE_PROXY_PROMPT_MODE, fileConfig.PROMPT_MODE, defaultConfig.PROMPT_MODE),
        OMIT_SYSTEM_PROMPT: (() => {
            const o = overrides.OMIT_SYSTEM_PROMPT;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_PROXY_OMIT_SYSTEM_PROMPT, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.OMIT_SYSTEM_PROMPT, undefined);
            if (f !== undefined) return f;
            return defaultConfig.OMIT_SYSTEM_PROMPT;
        })(),
        AUTO_CLEANUP_CONVERSATIONS: (() => {
            const o = overrides.AUTO_CLEANUP_CONVERSATIONS;
            if (o !== undefined && o !== null) return o;
            const e = parseBool(process.env.OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS, undefined);
            if (e !== undefined) return e;
            const f = parseBool(fileConfig.AUTO_CLEANUP_CONVERSATIONS, undefined);
            if (f !== undefined) return f;
            return defaultConfig.AUTO_CLEANUP_CONVERSATIONS;
        })(),
        CLEANUP_INTERVAL_MS: (() => {
            const o = overrides.CLEANUP_INTERVAL_MS;
            if (o !== undefined && o !== null) return o;
            const e = parseInt(process.env.OPENCODE_PROXY_CLEANUP_INTERVAL_MS);
            if (!isNaN(e) && e) return e;
            if (fileConfig.CLEANUP_INTERVAL_MS) return fileConfig.CLEANUP_INTERVAL_MS;
            return defaultConfig.CLEANUP_INTERVAL_MS;
        })(),
        CLEANUP_MAX_AGE_MS: (() => {
            const o = overrides.CLEANUP_MAX_AGE_MS;
            if (o !== undefined && o !== null) return o;
            const e = parseInt(process.env.OPENCODE_PROXY_CLEANUP_MAX_AGE_MS);
            if (!isNaN(e) && e) return e;
            if (fileConfig.CLEANUP_MAX_AGE_MS) return fileConfig.CLEANUP_MAX_AGE_MS;
            return defaultConfig.CLEANUP_MAX_AGE_MS;
        })()
    };

    // Scaleway Functions: /tmp is only writable; opencode jail must use /tmp
    // 同时默认关闭所有后台管理，保持无状态
    if (isScalewayFunctionEnv()) {
        finalConfig.USE_ISOLATED_HOME = true;
        finalConfig.AUTO_CLEANUP_CONVERSATIONS = false;
        finalConfig.METRICS_ENABLED = false;
        finalConfig.HEALTH_DETAILS_ENABLED = true;
        // 强制关闭后端托管，用户已明确不需要
        finalConfig.MANAGE_BACKEND = false;
    }
    // 全局默认：后台管理关闭（用户不需要）
    if (process.env.OPENCODE_PROXY_MANAGE_BACKEND === undefined && fileConfig.MANAGE_BACKEND === undefined && overrides.MANAGE_BACKEND === undefined) {
        finalConfig.MANAGE_BACKEND = false;
    }

    return finalConfig;
}
