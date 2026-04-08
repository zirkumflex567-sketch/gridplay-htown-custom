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

function extractResolutionFromCandidate(urlText) {
    const explicitMatches = [...urlText.matchAll(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240|144)p(?:[^0-9]|$)/gi)];
    if (explicitMatches.length > 0) {
        return Number(explicitMatches[0][1]);
    }

    const dimensions = [...urlText.matchAll(/(\d{3,4})x(\d{3,4})/gi)];
    if (dimensions.length > 0) {
        const heights = dimensions
            .map(match => Number(match[2]))
            .filter(Number.isFinite)
            .sort((a, b) => b - a);
        if (heights.length > 0) {
            return heights[0];
        }
    }

    return 0;
}

function getMediaType(parsedUrl) {
    const path = parsedUrl.pathname.toLowerCase();
    if (path.endsWith('.mp4')) {
        return 'mp4';
    }
    if (path.endsWith('.m3u8')) {
        return 'm3u8';
    }
    return 'other';
}

function collectMediaCandidates(html) {
    const normalizedHtml = normalizeEscapes(html);
    const rawMatches = normalizedHtml.match(/https:\/\/video\.pmvhaven\.com\/[\w\-./%?=&#+:,;~]+/gi) || [];
    const candidates = [];
    const seen = new Set();

    for (const raw of rawMatches) {
        try {
            const parsed = validateUpstreamMediaUrl(raw);
            const mediaType = getMediaType(parsed);
            if (mediaType === 'other') {
                continue;
            }

            const normalized = parsed.toString();
            if (seen.has(normalized)) {
                continue;
            }

            seen.add(normalized);
            candidates.push({
                url: normalized,
                resolution: extractResolutionFromCandidate(normalized),
                mediaType,
                progressiveScore: mediaType === 'mp4' ? 1 : 0
            });
        } catch (_) {
            continue;
        }
    }

    return candidates;
}

function pickBestMediaUrl(html) {
    const candidates = collectMediaCandidates(html);
    if (candidates.length === 0) {
        throw new Error('Could not find a playable PMVHaven media URL.');
    }

    candidates.sort((a, b) => {
        if (b.resolution !== a.resolution) {
            return b.resolution - a.resolution;
        }
        if (b.progressiveScore !== a.progressiveScore) {
            return b.progressiveScore - a.progressiveScore;
        }
        return a.url.localeCompare(b.url);
    });

    return {
        mediaUrl: candidates[0].url,
        chosenResolution: candidates[0].resolution,
        chosenType: candidates[0].mediaType,
        candidateCount: candidates.length
    };
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
        const picked = pickBestMediaUrl(html);
        const mediaUrl = picked.mediaUrl;
        const streamUrl = `/gridplay-api/stream?url=${encodeURIComponent(mediaUrl)}`;

        sendJson(res, 200, {
            sourceUrl: pageUrl.toString(),
            mediaUrl,
            streamUrl,
            chosenResolution: picked.chosenResolution,
            chosenType: picked.chosenType,
            candidateCount: picked.candidateCount
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
