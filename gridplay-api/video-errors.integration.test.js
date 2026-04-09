const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

function startServer(port, logPath) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            VIDEO_ERROR_LOG_PATH: logPath
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Server start timed out.'));
        }, 10000);

        child.stdout.on('data', data => {
            const text = String(data);
            if (text.includes('GridPlay PMVHaven API listening')) {
                clearTimeout(timeout);
                resolve(child);
            }
        });

        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Server exited unexpectedly with code ${code}.`));
        });
    });
}

function stopServer(child) {
    if (!child || child.killed) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        child.once('exit', () => resolve());
        child.kill();
    });
}

test('video-errors endpoint accepts and persists sanitized payload', async () => {
    const port = 4700 + Math.floor(Math.random() * 200);
    const logPath = path.join(os.tmpdir(), `gridplay-video-errors-${Date.now()}-${Math.random()}.jsonl`);
    const serverProcess = await startServer(port, logPath);

    try {
        const body = {
            url: 'https://example.com/video.mp4',
            reasonCode: 'startup-timeout',
            message: 'Playback never started',
            context: {
                tile: 'video-1',
                readyState: 0,
                globalPlaylist: false
            },
            videoId: 'video-1',
            attempt: 3,
            timestamp: '2026-01-01T12:00:00.000Z'
        };

        const response = await fetch(`http://127.0.0.1:${port}/video-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.ok, true);

        const logContent = await fs.readFile(logPath, 'utf8');
        const lines = logContent.trim().split('\n').filter(Boolean);
        assert.equal(lines.length, 1);

        const logged = JSON.parse(lines[0]);
        assert.equal(logged.url, body.url);
        assert.equal(logged.reasonCode, body.reasonCode);
        assert.equal(logged.message, body.message);
        assert.equal(logged.videoId, body.videoId);
        assert.equal(logged.attempt, body.attempt);
        assert.equal(logged.context.tile, body.context.tile);
    } finally {
        await stopServer(serverProcess);
        await fs.rm(logPath, { force: true });
    }
});

test('video-errors endpoint rejects malformed JSON body', async () => {
    const port = 4900 + Math.floor(Math.random() * 200);
    const logPath = path.join(os.tmpdir(), `gridplay-video-errors-${Date.now()}-${Math.random()}.jsonl`);
    const serverProcess = await startServer(port, logPath);

    try {
        const response = await fetch(`http://127.0.0.1:${port}/video-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"url": "https://example.com",'
        });

        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.equal(payload.error, 'Invalid JSON body.');
    } finally {
        await stopServer(serverProcess);
        await fs.rm(logPath, { force: true });
    }
});
