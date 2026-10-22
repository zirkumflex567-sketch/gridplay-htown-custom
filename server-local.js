#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3350);
const API_PORT = Number(process.env.API_PORT || 3351);
const API_V2_PORT = Number(process.env.API_V2_PORT || 3352);
const ROOT_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.txt': 'text/plain; charset=utf-8'
};

// Spawn background APIs
console.log('Starting GridPlay local backend services...');

const apiProcess = spawn(process.execPath, [path.join(ROOT_DIR, 'gridplay-api', 'server.js')], {
    env: { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1' },
    stdio: ['inherit', 'pipe', 'pipe']
});

apiProcess.stdout.on('data', (d) => process.stdout.write(`[API 3351] ${d}`));
apiProcess.stderr.on('data', (d) => process.stderr.write(`[API 3351 ERR] ${d}`));

const apiV2Process = spawn(process.execPath, [path.join(ROOT_DIR, 'gridplay-api-v2', 'server.js')], {
    env: { ...process.env, PORT: String(API_V2_PORT), HOST: '127.0.0.1' },
    stdio: ['inherit', 'pipe', 'pipe']
});

apiV2Process.stdout.on('data', (d) => process.stdout.write(`[API-v2 3352] ${d}`));
apiV2Process.stderr.on('data', (d) => process.stderr.write(`[API-v2 3352 ERR] ${d}`));

function cleanupChildren() {
    try { apiProcess.kill(); } catch (_) {}
    try { apiV2Process.kill(); } catch (_) {}
}

process.on('SIGINT', () => {
    cleanupChildren();
    process.exit(0);
});
process.on('SIGTERM', () => {
    cleanupChildren();
    process.exit(0);
});
process.on('exit', cleanupChildren);

function proxyRequest(req, res, targetPort) {
    const options = {
        hostname: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${targetPort}`,
            'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
            'x-forwarded-proto': 'http'
        }
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Backend proxy on port ${targetPort} failed: ${err.message}` }));
        } else {
            res.destroy();
        }
    });

    // Abort proxy if the client terminates the connection prematurely
    res.on('close', () => {
        if (!res.writableEnded) {
            proxyReq.destroy();
        }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
    } else {
        proxyReq.end();
    }
}

function serveStatic(req, res, filePath) {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // Route to PMVHaven API
    if (pathname.startsWith('/gridplay-api/')) {
        proxyRequest(req, res, API_PORT);
        return;
    }

    // Route to Multi-provider API v2
    if (pathname.startsWith('/gridplay-api-v2/')) {
        proxyRequest(req, res, API_V2_PORT);
        return;
    }

    // Redirects / shortcuts for v3
    if (pathname === '/' || pathname === '/v3' || pathname === '/v3/' ||
        pathname === '/gridplay' || pathname === '/gridplay/' ||
        pathname === '/gridplay/3' || pathname === '/gridplay/3/' ||
        pathname === '/gridplay/v3' || pathname === '/gridplay/v3/') {
        serveStatic(req, res, path.join(ROOT_DIR, 'v3', 'index.html'));
        return;
    }

    // Redirects / shortcuts for v2
    if (pathname === '/v2' || pathname === '/v2/' ||
        pathname === '/gridplay/2' || pathname === '/gridplay/2/' ||
        pathname === '/gridplay/v2' || pathname === '/gridplay/v2/') {
        serveStatic(req, res, path.join(ROOT_DIR, 'v2', 'index.html'));
        return;
    }

    // Serve static files safely
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let resolvedFile = path.join(ROOT_DIR, safePath);

    fs.stat(resolvedFile, (err, stats) => {
        if (!err && stats.isDirectory()) {
            resolvedFile = path.join(resolvedFile, 'index.html');
        }
        serveStatic(req, res, resolvedFile);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`  GridPlay Local Server is LIVE!`);
    console.log(`  Frontend (v3): http://localhost:${PORT}/`);
    console.log(`  Frontend (v3): http://localhost:${PORT}/v3/`);
    console.log(`  PMVHaven API:  http://localhost:${PORT}/gridplay-api/`);
    console.log(`  Multi-API v2:  http://localhost:${PORT}/gridplay-api-v2/`);
    console.log(`======================================================\n`);
});
