#!/usr/bin/env node
'use strict';

const http = require('http');
const { Readable } = require('stream');
const { URL } = require('url');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3350);
const PMVHAVEN_HOSTS = new Set(['pmvhaven.com', 'www.pmvhaven.com']);
const MEDIA_HOSTS = new Set(['video.pmvhaven.com']);
const PLAYLIST_ID_PATH_REGEX = /\/playlists\/([a-f0-9]{24})(?:[/?#]|$)/i;
const PAWG_KEYWORDS = [
    'pawg',
    'pmv',
    'bubble butt',
    'big ass',
    'thick',
    'twerk',
    'curvy'
];
const PMVHAVEN_DISCOVERY_URLS = [
    'https://pmvhaven.com/videos',
    'https://pmvhaven.com/videos?sort=trending',
    'https://pmvhaven.com/search?query=pawg',
    'https://pmvhaven.com/search?query=pmv'
];
const FALLBACK_DURATION_SECONDS = 240;

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

    const isArchiveHost = host === 'archive.org' || host.endsWith('.archive.org');
    if (!MEDIA_HOSTS.has(host) && !isArchiveHost) {
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

function getPlaylistIdFromUrl(playlistUrl) {
    const matched = (playlistUrl.pathname || '').match(PLAYLIST_ID_PATH_REGEX);
    return matched ? matched[1].toLowerCase() : null;
}

function extractNuxtPayloadArray(html) {
    const matched = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!matched || !matched[1]) {
        return null;
    }

    try {
        const parsed = JSON.parse(matched[1]);
        return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function dereferenceNuxtValue(table, maybeRef) {
    if (
        typeof maybeRef === 'number' &&
        Number.isInteger(maybeRef) &&
        maybeRef >= 0 &&
        maybeRef < table.length
    ) {
        return table[maybeRef];
    }

    return maybeRef;
}

function dereferenceString(table, maybeRef) {
    const value = dereferenceNuxtValue(table, maybeRef);
    return typeof value === 'string' ? normalizeEscapes(value) : null;
}

function pickPreferredMediaFromList(mediaUrlList) {
    const candidates = [];
    const seen = new Set();

    for (const rawUrl of mediaUrlList) {
        if (!rawUrl || typeof rawUrl !== 'string') {
            continue;
        }

        try {
            const parsed = validateUpstreamMediaUrl(rawUrl);
            const normalized = parsed.toString();
            if (seen.has(normalized)) {
                continue;
            }

            const mediaType = getMediaType(parsed);
            if (mediaType === 'other') {
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

    if (candidates.length === 0) {
        return null;
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

    return candidates[0];
}

function collectPlaylistLinksFromHtml(html) {
    const normalizedHtml = normalizeEscapes(html);
    const matches = normalizedHtml.match(/(?:https:\/\/(?:www\.)?pmvhaven\.com)?\/videos?\/[a-zA-Z0-9-]+/gi) || [];
    const links = [];
    const seen = new Set();

    for (const rawMatch of matches) {
        const rawUrl = rawMatch.startsWith('http')
            ? rawMatch
            : `https://pmvhaven.com${rawMatch}`;

        try {
            const parsed = getValidatedHttpsUrl(rawUrl);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname || '/';
            if (!PMVHAVEN_HOSTS.has(host)) {
                continue;
            }
            if (!path.includes('/video/') && !path.includes('/videos/')) {
                continue;
            }

            const normalized = `https://pmvhaven.com${path}`;
            if (seen.has(normalized)) {
                continue;
            }

            seen.add(normalized);
            links.push(normalized);
        } catch (_) {
            continue;
        }
    }

    return links;
}

function containsPawgKeywords(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }

    const normalized = text.toLowerCase();
    return PAWG_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function extractTitleFromHtml(html) {
    const matched = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!matched || !matched[1]) {
        return null;
    }

    return normalizeEscapes(matched[1])
        .replace(/\s+/g, ' ')
        .trim();
}

function parseHmsDurationToSeconds(rawDuration) {
    if (!rawDuration || typeof rawDuration !== 'string') {
        return null;
    }

    const parts = rawDuration.trim().split(':').map(part => Number(part));
    if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part))) {
        return null;
    }

    const normalized = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    const [hours, minutes, seconds] = normalized;
    return (hours * 3600) + (minutes * 60) + seconds;
}

function extractDurationSecondsFromHtml(html) {
    const numeric = html.match(/"duration"\s*:\s*(\d{2,6})/i);
    if (numeric && numeric[1]) {
        const parsed = Number(numeric[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    const iso = html.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
    if (iso) {
        const hours = Number(iso[1] || 0);
        const minutes = Number(iso[2] || 0);
        const seconds = Number(iso[3] || 0);
        const total = (hours * 3600) + (minutes * 60) + seconds;
        if (total > 0) {
            return total;
        }
    }

    return null;
}

async function fetchHtmlWithHeaders(url, userAgent) {
    const upstream = await fetch(url, {
        redirect: 'follow',
        headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml'
        }
    });

    if (!upstream.ok) {
        throw new Error(`HTTP ${upstream.status}`);
    }

    return upstream.text();
}

async function collectPmvhavenPawgItems(targetCount) {
    const wantedCount = Math.max(1, Number(targetCount) || 1);
    const candidateLinks = [];
    const seenLinks = new Set();

    for (const discoveryUrl of PMVHAVEN_DISCOVERY_URLS) {
        try {
            const html = await fetchHtmlWithHeaders(discoveryUrl, 'GridPlayPawgDiscovery/1.0');
            const links = collectPlaylistLinksFromHtml(html);
            for (const link of links) {
                if (seenLinks.has(link)) {
                    continue;
                }
                seenLinks.add(link);
                candidateLinks.push(link);
            }
        } catch (_) {
            continue;
        }
    }

    const maxCandidates = Math.min(candidateLinks.length, Math.max(wantedCount * 6, 20));
    const items = [];
    const seenMediaUrls = new Set();

    for (let i = 0; i < maxCandidates; i++) {
        if (items.length >= wantedCount) {
            break;
        }

        const pageUrl = candidateLinks[i];
        try {
            const html = await fetchHtmlWithHeaders(pageUrl, 'GridPlayPawgResolver/1.0');
            const title = extractTitleFromHtml(html) || `PMVHaven Clip ${items.length + 1}`;
            const keywordContext = `${title} ${pageUrl} ${html.slice(0, 2500)}`;
            if (!containsPawgKeywords(keywordContext)) {
                continue;
            }

            const picked = pickBestMediaUrl(html);
            if (seenMediaUrls.has(picked.mediaUrl)) {
                continue;
            }
            seenMediaUrls.add(picked.mediaUrl);

            const durationSeconds = extractDurationSecondsFromHtml(html);
            items.push({
                id: null,
                title,
                pageUrl,
                mediaUrl: picked.mediaUrl,
                playbackUrl: `/gridplay-api/stream?url=${encodeURIComponent(picked.mediaUrl)}`,
                streamUrl: `/gridplay-api/stream?url=${encodeURIComponent(picked.mediaUrl)}`,
                mediaType: picked.chosenType,
                durationSeconds,
                source: 'pmvhaven'
            });
        } catch (_) {
            continue;
        }
    }

    return items;
}

function pickArchiveMp4File(files) {
    if (!Array.isArray(files)) {
        return null;
    }

    const mp4Candidates = files.filter(file => {
        if (!file || typeof file.name !== 'string') {
            return false;
        }
        const name = file.name.toLowerCase();
        const format = typeof file.format === 'string' ? file.format.toLowerCase() : '';
        return name.endsWith('.mp4') || format.includes('mpeg4');
    });

    if (mp4Candidates.length === 0) {
        return null;
    }

    mp4Candidates.sort((a, b) => {
        const aSize = Number(a.size) || 0;
        const bSize = Number(b.size) || 0;
        return bSize - aSize;
    });

    return mp4Candidates[0];
}

async function collectFallbackPawgItems(targetCount) {
    const wantedCount = Math.max(1, Number(targetCount) || 1);
    const searchUrl = new URL('https://archive.org/advancedsearch.php');
    searchUrl.searchParams.set('q', '(title:(pawg OR pmv) OR subject:(pawg OR pmv)) AND mediatype:(movies)');
    searchUrl.searchParams.set('fl[]', 'identifier,title');
    searchUrl.searchParams.set('rows', String(Math.max(20, wantedCount * 6)));
    searchUrl.searchParams.set('page', '1');
    searchUrl.searchParams.set('output', 'json');

    const searchResponse = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'GridPlayPawgFallback/1.0',
            Accept: 'application/json'
        }
    });

    if (!searchResponse.ok) {
        throw new Error(`Fallback search failed with HTTP ${searchResponse.status}`);
    }

    const searchPayload = await searchResponse.json();
    const docs = searchPayload && searchPayload.response && Array.isArray(searchPayload.response.docs)
        ? searchPayload.response.docs
        : [];

    const items = [];
    const seenUrls = new Set();
    for (const doc of docs) {
        if (items.length >= wantedCount) {
            break;
        }

        const identifier = doc && typeof doc.identifier === 'string'
            ? doc.identifier
            : null;
        if (!identifier) {
            continue;
        }

        try {
            const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
                headers: {
                    'User-Agent': 'GridPlayPawgFallback/1.0',
                    Accept: 'application/json'
                }
            });
            if (!metadataResponse.ok) {
                continue;
            }

            const metadata = await metadataResponse.json();
            const pickedFile = pickArchiveMp4File(metadata.files);
            if (!pickedFile) {
                continue;
            }

            const mediaUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(pickedFile.name)}`;
            if (seenUrls.has(mediaUrl)) {
                continue;
            }
            seenUrls.add(mediaUrl);

            const durationSeconds = parseHmsDurationToSeconds(pickedFile.length);
            items.push({
                id: null,
                title: (doc.title && String(doc.title).trim()) || identifier,
                pageUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
                mediaUrl,
                playbackUrl: `/gridplay-api/stream?url=${encodeURIComponent(mediaUrl)}`,
                streamUrl: `/gridplay-api/stream?url=${encodeURIComponent(mediaUrl)}`,
                mediaType: 'mp4',
                durationSeconds,
                source: 'fallback'
            });
        } catch (_) {
            continue;
        }
    }

    return items;
}

function capItemsBySelectionMode(items, mode, count, targetMinutes) {
    if (!Array.isArray(items)) {
        return [];
    }

    const safeCount = Math.min(Math.max(Number(count) || 8, 1), 50);
    if (mode !== 'duration') {
        return items.slice(0, safeCount);
    }

    const targetSeconds = Math.max(Number(targetMinutes) || 20, 1) * 60;
    const selected = [];
    let total = 0;
    for (const item of items) {
        if (selected.length >= 50) {
            break;
        }
        selected.push(item);
        total += Number(item.durationSeconds) > 0
            ? Number(item.durationSeconds)
            : FALLBACK_DURATION_SECONDS;
        if (total >= targetSeconds && selected.length > 0) {
            break;
        }
    }

    return selected;
}

async function handlePawgMix(reqUrl, res) {
    const mode = reqUrl.searchParams.get('mode') === 'duration' ? 'duration' : 'count';
    const count = Math.min(Math.max(Number(reqUrl.searchParams.get('count')) || 8, 1), 50);
    const targetMinutes = Math.min(Math.max(Number(reqUrl.searchParams.get('targetMinutes')) || 25, 1), 240);

    const desiredSeedCount = mode === 'duration'
        ? Math.min(Math.max(Math.ceil(targetMinutes / 3), 8), 50)
        : count;

    try {
        const pmvhavenItems = await collectPmvhavenPawgItems(desiredSeedCount);
        const missingCount = Math.max(desiredSeedCount - pmvhavenItems.length, 0);
        let fallbackItems = [];

        if (missingCount > 0) {
            try {
                fallbackItems = await collectFallbackPawgItems(missingCount);
            } catch (_) {
                fallbackItems = [];
            }
        }

        const combinedItems = capItemsBySelectionMode(
            [...pmvhavenItems, ...fallbackItems],
            mode,
            count,
            targetMinutes
        );

        const estimatedDurationSeconds = combinedItems.reduce((total, item) => {
            const seconds = Number(item.durationSeconds) > 0
                ? Number(item.durationSeconds)
                : FALLBACK_DURATION_SECONDS;
            return total + seconds;
        }, 0);

        sendJson(res, 200, {
            mode,
            countRequested: count,
            targetMinutesRequested: targetMinutes,
            sourcePriority: ['pmvhaven', 'fallback'],
            count: combinedItems.length,
            estimatedDurationMinutes: Number((estimatedDurationSeconds / 60).toFixed(1)),
            breakdown: {
                pmvhaven: combinedItems.filter(item => item.source === 'pmvhaven').length,
                fallback: combinedItems.filter(item => item.source === 'fallback').length
            },
            items: combinedItems
        });
    } catch (error) {
        sendJson(res, 502, { error: `PAWG mix generation failed: ${error.message}` });
    }
}

function extractPlaylistItemsFromNuxt(html, playlistUrl) {
    const playlistId = getPlaylistIdFromUrl(playlistUrl);
    if (!playlistId) {
        return [];
    }

    const table = extractNuxtPayloadArray(html);
    if (!table) {
        return [];
    }

    const stateKey = `playlist-initial-${playlistId}`;
    let payloadRef = null;

    for (const entry of table) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(entry, stateKey)) {
            const candidateRef = entry[stateKey];
            if (typeof candidateRef === 'number' && candidateRef >= 0) {
                payloadRef = candidateRef;
                break;
            }
        }
    }

    if (payloadRef === null) {
        return [];
    }

    const payload = dereferenceNuxtValue(table, payloadRef);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return [];
    }

    const playlist = dereferenceNuxtValue(table, payload.playlist);
    if (!playlist || typeof playlist !== 'object' || Array.isArray(playlist)) {
        return [];
    }

    const videoRefs = dereferenceNuxtValue(table, playlist.videos);
    if (!Array.isArray(videoRefs)) {
        return [];
    }

    const videoIds = [];
    const seenIds = new Set();
    for (const videoRef of videoRefs) {
        const id = dereferenceString(table, videoRef);
        if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
            continue;
        }
        const normalizedId = id.toLowerCase();
        if (seenIds.has(normalizedId)) {
            continue;
        }
        seenIds.add(normalizedId);
        videoIds.push(normalizedId);
    }

    if (videoIds.length === 0) {
        return [];
    }

    const detailsById = new Map();
    const detailRefs = dereferenceNuxtValue(table, playlist.videoDetails);
    if (Array.isArray(detailRefs)) {
        for (const detailRef of detailRefs) {
            const detail = dereferenceNuxtValue(table, detailRef);
            if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
                continue;
            }

            const id = dereferenceString(table, detail._id);
            if (!id || !/^[a-f0-9]{24}$/i.test(id)) {
                continue;
            }

            detailsById.set(id.toLowerCase(), {
                title: dereferenceString(table, detail.title),
                videoUrl: dereferenceString(table, detail.videoUrl),
                hlsMasterPlaylistUrl: dereferenceString(table, detail.hlsMasterPlaylistUrl)
            });
        }
    }

    return videoIds.map(id => {
        const detail = detailsById.get(id) || null;
        const preferred = detail
            ? pickPreferredMediaFromList([detail.videoUrl, detail.hlsMasterPlaylistUrl])
            : null;
        const mediaUrl = preferred ? preferred.url : null;

        return {
            id,
            title: detail && detail.title ? detail.title : null,
            pageUrl: `https://pmvhaven.com/videos/${id}`,
            mediaUrl,
            streamUrl: mediaUrl
                ? `/gridplay-api/stream?url=${encodeURIComponent(mediaUrl)}`
                : null,
            mediaType: preferred ? preferred.mediaType : null
        };
    });
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
        const extractedItems = extractPlaylistItemsFromNuxt(html, playlistUrl);
        const items = extractedItems.length > 0
            ? extractedItems
            : collectPlaylistLinksFromHtml(html).map(pageUrl => ({
                id: null,
                title: null,
                pageUrl,
                mediaUrl: null,
                streamUrl: null,
                mediaType: null
            }));

        sendJson(res, 200, {
            playlistUrl: playlistUrl.toString(),
            links: items.map(item => item.pageUrl),
            streamLinks: items
                .filter(item => typeof item.streamUrl === 'string')
                .map(item => item.streamUrl),
            count: items.length,
            resolvedCount: items.filter(item => typeof item.streamUrl === 'string').length,
            items
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
        const upstreamHost = mediaUrl.hostname.toLowerCase();
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Referer': 'https://pmvhaven.com/',
            'Accept': '*/*',
            'Origin': 'https://pmvhaven.com'
        };
        if (MEDIA_HOSTS.has(upstreamHost)) {
            headers.Referer = 'https://pmvhaven.com/';
        }
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

        const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
        const mediaUrlStr = mediaUrl.toString().toLowerCase();
        const isM3u8 = contentType.includes('mpegurl') || contentType.includes('m3u8') || mediaUrlStr.includes('.m3u8');

        if (isM3u8 && req.method !== 'HEAD' && upstream.body) {
            const body = await upstream.text();
            
            // Critical: Use the final URL after redirects as the base for resolving relative paths
            const baseUrl = upstream.url;
            
            // 1. Rewrite absolute/relative URIs on standalone lines
            // 2. Rewrite URIs inside tags like URI="path/to/segment"
            const lines = body.split('\n');
            const rewrittenLines = lines.map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // Handle tags with URI attributes: e.g. #EXT-X-MAP:URI="init.mp4"
                if (trimmed.startsWith('#')) {
                    return line.replace(/URI="([^"]+)"/g, (match, p1) => {
                        try {
                            const abs = new URL(p1, baseUrl).toString();
                            return `URI="/gridplay-api/stream?url=${encodeURIComponent(abs)}"`;
                        } catch (e) {
                            return match;
                        }
                    });
                }

                // A line in M3U8 that doesn't start with # and isn't empty is a URI.
                try {
                    const absoluteUrl = new URL(trimmed, baseUrl).toString();
                    return `/gridplay-api/stream?url=${encodeURIComponent(absoluteUrl)}`;
                } catch (e) {
                    return line;
                }
            });

            const rewrittenBody = rewrittenLines.join('\n');
            const buf = Buffer.from(rewrittenBody, 'utf8');
            
            responseHeaders['content-length'] = buf.length.toString();
            res.writeHead(upstream.status, responseHeaders);
            res.end(buf);
            return;
        }

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

    if (reqUrl.pathname === '/pawg-mix' && req.method === 'GET') {
        await handlePawgMix(reqUrl, res);
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
