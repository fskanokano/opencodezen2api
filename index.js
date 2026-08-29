import { startProxy } from './src/proxy.js';
import { buildConfig } from './src/config.js';

// Scaleway-aware unified config (minimal change: delegated to src/config.js)
const finalConfig = buildConfig();

// Backwards compat: keep fs check log for user visibility
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    console.log('[Config] Loaded from config.json (via src/config.js)');
}

// Validate required configuration
if (!finalConfig.OPENCODE_PATH) {
    console.error('[Error] OPENCODE_PATH is not set. Please configure it in config.json or environment variable.');
    process.exit(1);
}

// Check if opencode is available
import { execSync } from 'child_process';
try {
    execSync(`"${finalConfig.OPENCODE_PATH}" --version`, { stdio: 'ignore' });
} catch (e) {
    console.warn(`[Warning] Cannot verify OpenCode installation: ${finalConfig.OPENCODE_PATH}`);
    console.warn('[Warning] Please ensure OpenCode is installed:');
    console.warn('  Windows: npm install -g opencode-ai');
    console.warn('  Linux/macOS: curl -fsSL https://opencode.ai/install | bash');
    console.warn('[Warning] Or specify the full path in config.json:');
    console.warn('  { "OPENCODE_PATH": "C:\\\\Users\\\\YourName\\\\AppData\\\\Roaming\\\\npm\\\\opencode.cmd" }');
}

console.log('[Config] Starting with configuration:');
console.log(`  - Port: ${finalConfig.PORT}`);
console.log(`  - Bind Host: ${finalConfig.BIND_HOST}`);
console.log(`  - Backend: ${finalConfig.OPENCODE_SERVER_URL}`);
console.log(`  - Backend Password: ${finalConfig.OPENCODE_SERVER_PASSWORD ? 'Configured' : 'Not configured'}`);
console.log(`  - OpenCode Path: ${finalConfig.OPENCODE_PATH}`);
console.log(`  - API Key: ${finalConfig.API_KEY ? 'Configured' : 'Not configured (no auth)'}`);
console.log(`  - Zen API Key: ${finalConfig.ZEN_API_KEY ? 'Configured' : 'Not configured'}`);
console.log(`  - Disable Tools: ${finalConfig.DISABLE_TOOLS ? 'Yes' : 'No'}`);
console.log(`  - External Tools Mode: ${finalConfig.EXTERNAL_TOOLS_MODE}`);
console.log(`  - External Tools Conflict Policy: ${finalConfig.EXTERNAL_TOOLS_CONFLICT_POLICY}`);
console.log(`  - Internal web_fetch Enabled: ${finalConfig.INTERNAL_WEB_FETCH_ENABLED ? 'Yes' : 'No'}`);
console.log(`  - Internal Allowed Tools: ${finalConfig.INTERNAL_ALLOWED_TOOLS.length ? finalConfig.INTERNAL_ALLOWED_TOOLS.join(', ') : '(none)'}`);
console.log(`  - Internal Tool Metrics Enabled: ${finalConfig.INTERNAL_TOOL_METRICS_ENABLED ? 'Yes' : 'No'}`);
console.log(`  - Internal Tool Discovery Fixture: ${finalConfig.INTERNAL_TOOL_DISCOVERY_FIXTURE.length ? finalConfig.INTERNAL_TOOL_DISCOVERY_FIXTURE.join(', ') : '(none)'}`);
console.log(`  - Health Details Enabled: ${finalConfig.HEALTH_DETAILS_ENABLED ? 'Yes' : 'No'}`);
console.log(`  - Health Details Require Auth: ${finalConfig.HEALTH_DETAILS_REQUIRE_AUTH ? 'Yes' : 'No'}`);
console.log(`  - Metrics Enabled: ${finalConfig.METRICS_ENABLED ? 'Yes' : 'No'}`);
console.log(`  - Metrics Require Auth: ${finalConfig.METRICS_REQUIRE_AUTH ? 'Yes' : 'No'}`);
console.log(`  - Use Isolated Home: ${finalConfig.USE_ISOLATED_HOME ? 'Yes' : 'No'}`);
console.log(`  - Request Timeout: ${finalConfig.REQUEST_TIMEOUT_MS}ms`);
console.log(`  - Prompt Mode: ${finalConfig.PROMPT_MODE}`);
console.log(`  - Omit System Prompt: ${finalConfig.OMIT_SYSTEM_PROMPT ? 'Yes' : 'No'}`);
console.log(`  - Auto Cleanup Conversations: ${finalConfig.AUTO_CLEANUP_CONVERSATIONS ? 'Yes' : 'No'}`);
console.log(`  - Cleanup Interval: ${finalConfig.CLEANUP_INTERVAL_MS}ms`);
console.log(`  - Cleanup Max Age: ${finalConfig.CLEANUP_MAX_AGE_MS}ms`);
console.log(`  - Debug: ${finalConfig.DEBUG ? 'Yes' : 'No'}`);

// A rejected promise inside a request handler must not take the whole proxy down.
// Node's default --unhandled-rejections=throw turns one bad request into a process
// exit, which reads to users as "the service stopped working after a while".
process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.error('[Proxy] Unhandled rejection (request dropped, server continues):', detail);
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
});

// Start the proxy
try {
    const proxy = startProxy(finalConfig);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n[Shutdown] Received SIGINT, shutting down gracefully...');
        proxy.killBackend();
        proxy.server.close(() => {
            console.log('[Shutdown] Server closed');
            process.exit(0);
        });
    });
    
    process.on('SIGTERM', () => {
        console.log('\n[Shutdown] Received SIGTERM, shutting down gracefully...');
        proxy.killBackend();
        proxy.server.close(() => {
            console.log('[Shutdown] Server closed');
            process.exit(0);
        });
    });
} catch (error) {
    console.error('[Fatal] Failed to start proxy:', error.message);
    process.exit(1);
}
