#!/usr/bin/env node
'use strict';

const http = require('http');
const { Readable } = require('stream');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3350);
const PMVHAVEN_HOSTS = new Set(['pmvhaven.com', 'www.pmvhaven.com']);
const MEDIA_HOSTS = new Set(['video.pmvhaven.com']);

function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}

function getValidatedHttpsUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new Error('Missing url query parameter.');
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_) {
        throw new Error('Invalid URL.');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('Only https URLs are allowed.');
    }

    return parsed;
}

function validatePmvhavenPageUrl(rawUrl) {
    const parsed = getValidatedHttpsUrl(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '/';

    if (!PMVHAVEN_HOSTS.has(host)) {
        throw new Error('Only pmvhaven.com video page URLs are supported.');
    }

    if (!path.includes('/video/') && !path.includes('/videos/')) {
        throw new Error('URL must contain /video/ or /videos/.');
    }

    return parsed;
}

function validateUpstreamMediaUrl(rawUrl) {
    const parsed = getValidatedHttpsUrl(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (!MEDIA_HOSTS.has(host)) {
        throw new Error('Upstream media host is not allowlisted.');
    }

    return parsed;
}

function normalizeEscapes(value) {
    return value
        .replace(/\\u002F/g, '/')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
}

function pickBestMediaUrl(html) {
    const patterns = [
        /https:\/\/video\.pmvhaven\.com\/videos\/[^"]+?\.mp4(?!\/[0-9]+p\.m3u8)(?:\?[^"]*)?/gi,
        /https:\/\/video\.pmvhaven\.com\/videos\/[^"]+?\.mp4(?:\?[^"]*)?/gi,
        /https:\/\/video\.pmvhaven\.com\/[^"]+?\.m3u8(?:\?[^"]*)?/gi,
        /https:\/\/video\.pmvhaven\.com\/[^"]+?\.mp4(?:\?[^"]*)?/gi,
        /"contentUrl"\s*:\s*"(https:\/\/video\.pmvhaven\.com[^"]+)"/gi,
        /"src"\s*:\s*"(https:\/\/video\.pmvhaven\.com[^"]+)"/gi
    ];

    for (const pattern of patterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length === 0) {
            continue;
        }

        for (const match of matches) {
            const candidate = normalizeEscapes(match[1] || match[0]);
            try {
                const validated = validateUpstreamMediaUrl(candidate);
                return validated.toString();
            } catch (_) {
                continue;
            }
        }
    }

    throw new Error('Could not find a playable PMVHaven media URL.');
}

async function handleResolve(reqUrl, res) {
    let pageUrl;
    try {
        pageUrl = validatePmvhavenPageUrl(reqUrl.searchParams.get('url'));
    } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
    }

    try {
        const upstream = await fetch(pageUrl, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'GridPlayResolver/1.0 (+https://h-town.duckdns.org/gridplay/)',
                Accept: 'text/html,application/xhtml+xml'
            }
        });

        if (!upstream.ok) {
            sendJson(res, 502, { error: `PMVHaven returned HTTP ${upstream.status}.` });
            return;
        }

        const html = await upstream.text();
        const mediaUrl = pickBestMediaUrl(html);
        const streamUrl = `/gridplay-api/stream?url=${encodeURIComponent(mediaUrl)}`;

        sendJson(res, 200, {
            sourceUrl: pageUrl.toString(),
            mediaUrl,
            streamUrl
        });
    } catch (error) {
        sendJson(res, 502, { error: `Resolve failed: ${error.message}` });
    }
}

async function handlePlaylist(reqUrl, res) {
    let playlistUrl;
    try {
        playlistUrl = getValidatedHttpsUrl(reqUrl.searchParams.get('url'));
    } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
    }

    try {
        const upstream = await fetch(playlistUrl, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'GridPlayPlaylistExtractor/1.0',
                Accept: 'text/html'
            }
        });

        if (!upstream.ok) {
            sendJson(res, 502, { error: `PMVHaven returned HTTP ${upstream.status}.` });
            return;
        }

        const html = await upstream.text();
        const videoLinkRegex = /\/video\/([a-zA-Z0-9-]+)/g;
        const links = new Set();
        let match;
        while ((match = videoLinkRegex.exec(html)) !== null) {
            links.add(`https://pmvhaven.com/video/${match[1]}`);
        }

        sendJson(res, 200, {
            playlistUrl: playlistUrl.toString(),
            links: Array.from(links)
        });
    } catch (error) {
        sendJson(res, 502, { error: `Playlist extraction failed: ${error.message}` });
    }
}

async function handleStream(req, reqUrl, res) {
    let mediaUrl;
    try {
        mediaUrl = validateUpstreamMediaUrl(reqUrl.searchParams.get('url'));
    } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
    }

    try {
        const headers = {
            'User-Agent': 'GridPlayProxy/1.0 (+https://h-town.duckdns.org/gridplay/)',
            Referer: 'https://pmvhaven.com/'
        };
        const range = req.headers.range;
        if (range) {
            headers.Range = range;
        }

        const upstream = await fetch(mediaUrl, {
            method: req.method,
            redirect: 'follow',
            headers
        });

        if (!upstream.ok && upstream.status !== 206) {
            sendJson(res, upstream.status, { error: `Upstream returned HTTP ${upstream.status}.` });
            return;
        }

        const passthroughHeaders = [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'cache-control',
            'etag',
            'last-modified',
            'content-disposition'
        ];

        const responseHeaders = {};
        for (const key of passthroughHeaders) {
            const value = upstream.headers.get(key);
            if (value) {
                responseHeaders[key] = value;
            }
        }

        responseHeaders['X-GridPlay-Proxy'] = 'pmvhaven';
        res.writeHead(upstream.status, responseHeaders);

        if (req.method === 'HEAD' || !upstream.body) {
            res.end();
            return;
        }

        Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
        sendJson(res, 502, { error: `Stream proxy failed: ${error.message}` });
    }
}

const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed.' });
        return;
    }

    if (reqUrl.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (reqUrl.pathname === '/resolve' && req.method === 'GET') {
        await handleResolve(reqUrl, res);
        return;
    }

    if (reqUrl.pathname === '/playlist' && req.method === 'GET') {
        await handlePlaylist(reqUrl, res);
        return;
    }

    if (reqUrl.pathname === '/stream') {
        await handleStream(req, reqUrl, res);
        return;
    }

    sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
    process.stdout.write(`GridPlay PMVHaven API listening on ${HOST}:${PORT}\n`);
});
