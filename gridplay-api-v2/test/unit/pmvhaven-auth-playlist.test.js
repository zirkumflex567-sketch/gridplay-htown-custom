'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const pmv = require('../../src/providers/pmvhaven.provider');

const playlistId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id1 = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const id2 = 'cccccccccccccccccccccccc';
const mp4 = 'https://video.pmvhaven.com/media/sample-1080p.mp4';
const hls = 'https://video.pmvhaven.com/media/master.m3u8';
function fixture() {
  const values = [];
  values[0] = { [`playlist-initial-${playlistId}`]: 1 };
  values[1] = { playlist: 2 };
  values[2] = { videos: 3, videoDetails: 4 };
  values[3] = [5, 6];
  values[4] = [7, 8];
  values[5] = id1;
  values[6] = id2;
  values[7] = { _id: 5, title: 9, videoUrl: 10 };
  values[8] = { _id: 6, title: 11, hlsMasterPlaylistUrl: 12 };
  values[9] = 'MP4 video';
  values[10] = mp4;
  values[11] = 'HLS video';
  values[12] = hls;
  return '<html><script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(values) + '</script></html>';
}

test('PMVHaven playlist returns actual media links with stable video ordering', async () => {
  const result = await pmv.resolvePlaylist(`https://pmvhaven.com/playlists/${playlistId}`,
    { fetchHtml: async () => fixture() });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map(i => i.pageUrl),
    [`https://pmvhaven.com/videos/${id1}`, `https://pmvhaven.com/videos/${id2}`]);
  assert.equal(result.items[0].mediaUrl, mp4);
  assert.equal(result.items[1].mediaUrl, hls);
  assert.equal(result.items[0].mediaType, 'mp4');
  assert.equal(result.items[1].mediaType, 'm3u8');
  assert.match(result.items[1].streamUrl, /\/gridplay-api-v2\/stream\?url=/);
  assert.ok(!result.items[0].streamUrl.includes('/videos/'));
});

test('PMVHaven video candidate resolves to playable MP4, never page HTML', async () => {
  const result = await pmv.resolveVideo(`https://pmvhaven.com/videos/${id1}`,
    { fetchHtml: async () => fixture() });
  assert.equal(result.mediaUrl, mp4);
  assert.equal(result.mediaType, 'mp4');
});

test('saved PMVHaven cookie is attached to provider page requests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmvhaven-test-'));
  const file = path.join(dir, 'auth.json');
  const originalFetch = global.fetch;
  const originalEnv = process.env.PMVHAVEN_AUTH_PATH;
  try {
    fs.writeFileSync(file, JSON.stringify({ cookies: 'better-auth.session_token=TEST' }));
    process.env.PMVHAVEN_AUTH_PATH = file;
    let cookie = null;
    global.fetch = async (_url, options) => {
      cookie = options.headers.Cookie;
      return { ok: true, text: async () => fixture() };
    };
    await pmv.resolveVideo(`https://pmvhaven.com/videos/${id1}`);
    assert.equal(cookie, 'better-auth.session_token=TEST');
  } finally {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.PMVHAVEN_AUTH_PATH;
    else process.env.PMVHAVEN_AUTH_PATH = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inline v3 JavaScript syntax remains valid after UI changes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../../v3/index.html'), 'utf8');
  const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]));
  }
});
