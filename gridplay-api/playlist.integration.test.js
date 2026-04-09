const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PLAYLIST_URL = 'https://pmvhaven.com/playlists/693df46ab485fa3700cbfd03';

function startServer(port) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Server start timed out.'));
        }, 15000);

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

test('playlist endpoint returns many items and direct stream links', async () => {
    const port = 4300 + Math.floor(Math.random() * 400);
    const serverProcess = await startServer(port);

    try {
        const response = await fetch(`http://127.0.0.1:${port}/playlist?url=${encodeURIComponent(PLAYLIST_URL)}`);
        assert.equal(response.status, 200);

        const payload = await response.json();
        assert.ok(Array.isArray(payload.items), 'Expected an items array in /playlist response.');
        assert.ok(payload.items.length > 10, 'Expected more than 10 playlist items.');

        const streamCount = payload.items.filter(item => typeof item.streamUrl === 'string' && item.streamUrl.includes('/stream?url=')).length;
        assert.ok(streamCount > 5, 'Expected multiple direct stream URLs in playlist response.');
    } finally {
        await stopServer(serverProcess);
    }
});
