const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

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
        }, 20000);

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

test('pawg mix endpoint returns playable items with source metadata', async () => {
    const port = 4600 + Math.floor(Math.random() * 300);
    const serverProcess = await startServer(port);

    try {
        const response = await fetch(`http://127.0.0.1:${port}/pawg-mix?mode=count&count=4`);
        assert.equal(response.status, 200);

        const payload = await response.json();
        assert.ok(Array.isArray(payload.items), 'Expected items array in /pawg-mix response.');
        assert.ok(payload.items.length > 0, 'Expected at least one generated item.');
        assert.ok(payload.items.length <= 4, 'Expected result to honor requested count.');

        const first = payload.items[0];
        assert.equal(typeof first.title, 'string');
        assert.ok(first.playbackUrl, 'Expected playbackUrl in generated item.');
        assert.ok(
            first.playbackUrl.includes('/gridplay-api/stream?url=') || first.playbackUrl.endsWith('.mp4'),
            'Expected playable proxy stream URL or direct MP4 fallback.'
        );

        assert.equal(payload.sourcePriority[0], 'pmvhaven');
        assert.equal(payload.mediaPolicy.preferredType, 'mp4');
        assert.equal(typeof payload.mediaPolicy.hlsFallbackUsed, 'boolean');
        assert.ok(Array.isArray(payload.added), 'Expected added list to echo selected videos.');
        assert.equal(typeof payload.breakdown.pmvhaven, 'number');
        assert.equal(typeof payload.breakdown.fallback, 'number');

        const hasM3u8 = payload.items.some(item => item.mediaType === 'm3u8');
        if (payload.mediaPolicy.hlsFallbackUsed) {
            assert.ok(hasM3u8, 'Expected at least one HLS item when fallback flag is set.');
        } else {
            assert.equal(hasM3u8, false, 'Expected MP4-only items when HLS fallback is disabled.');
        }
    } finally {
        await stopServer(serverProcess);
    }
});
