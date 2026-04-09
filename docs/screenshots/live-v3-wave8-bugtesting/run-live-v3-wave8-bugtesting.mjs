import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET_URL = 'https://h-town.duckdns.org/gridplay/v3/';
const ARTIFACT_DIR = path.resolve(process.cwd(), 'docs/screenshots/live-v3-wave8-bugtesting');
const RESULTS_PATH = path.join(ARTIFACT_DIR, 'test-results.json');
const VIDEO_PATH = path.join(ARTIFACT_DIR, 'session-video.webm');

const TEST_URLS = {
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  mp4: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  deadMp4: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/__wave8_not_found__.mp4'
};

const runStartedAt = new Date().toISOString();
const assertionResults = [];
const consoleMessages = [];
const pageErrors = [];
const capturedScreenshots = [];

function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

function recordAssertion(name, passed, details = {}) {
  assertionResults.push({
    name,
    passed,
    timestamp: nowIso(),
    details
  });
}

async function runAssertion(name, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    recordAssertion(name, true, {
      durationMs: Date.now() - start,
      ...(details && typeof details === 'object' ? details : { value: details })
    });
  } catch (error) {
    recordAssertion(name, false, {
      durationMs: Date.now() - start,
      error: toErrorMessage(error)
    });
  }
}

async function takeShot(page, name) {
  const target = path.join(ARTIFACT_DIR, name);
  await page.screenshot({ path: target, fullPage: true });
  capturedScreenshots.push(name);
  return target;
}

async function addSingleUrl(page, url) {
  await page.evaluate(async (nextUrl) => {
    const input = document.getElementById('urlInput');
    input.value = nextUrl;
    await addFromInputSmart();
  }, url);
}

async function waitForTileCount(page, expectedCount, timeout = 25000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('.video-item').length >= count,
    expectedCount,
    { timeout }
  );
}

async function ensureNotHidden(page, selector, timeout = 5000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    },
    selector,
    { timeout }
  );
}

await fs.mkdir(ARTIFACT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  ignoreHTTPSErrors: true,
  recordVideo: {
    dir: ARTIFACT_DIR,
    size: { width: 1280, height: 720 }
  }
});

const page = await context.newPage();
const pageVideo = page.video();

page.on('console', msg => {
  consoleMessages.push({
    type: msg.type(),
    text: msg.text(),
    timestamp: nowIso()
  });
});

page.on('pageerror', error => {
  pageErrors.push({
    message: toErrorMessage(error),
    timestamp: nowIso()
  });
});

let runError = null;

try {
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.evaluate(() => {
    if (!window.__wave8Hooks) {
      window.__wave8Hooks = {
        iframeCommands: []
      };
      const originalSend = sendIframeProviderCommand;
      sendIframeProviderCommand = function(tile, muted) {
        try {
          window.__wave8Hooks.iframeCommands.push({
            provider: tile && tile.provider ? tile.provider : null,
            videoId: tile && tile.videoId ? tile.videoId : null,
            muted: Boolean(muted),
            timestamp: Date.now()
          });
        } catch (_) {
          // Non-fatal hook failures must not alter app behavior.
        }
        return originalSend.apply(this, arguments);
      };
    }
  });

  await runAssertion('A) Core UI loads with expected controls', async () => {
    await page.waitForSelector('#urlInput', { timeout: 15000 });
    await page.waitForSelector('#playlistEditorOpenBtn', { timeout: 15000 });
    await page.waitForSelector('#globalMuteToggle', { timeout: 15000 });
    await page.waitForSelector('#controlsToggle', { timeout: 15000 });
    await page.waitForSelector('button[onclick="toggleBulkModule()"]', { timeout: 15000 });
    await takeShot(page, '01-core-ui.png');
    return { url: page.url() };
  });

  await runAssertion('B1) Add one YouTube iframe + one HTML5 MP4', async () => {
    await addSingleUrl(page, TEST_URLS.youtube);
    await waitForTileCount(page, 1);
    await addSingleUrl(page, TEST_URLS.mp4);
    await waitForTileCount(page, 2);
    await page.waitForSelector('.video-item iframe', { timeout: 20000 });
    await page.waitForSelector('.video-item video', { timeout: 20000 });
    await takeShot(page, '02-mixed-tiles-added.png');
    return {
      tileCount: await page.locator('.video-item').count()
    };
  });

  await runAssertion('B2) Global mute labels + HTML5 muted states + iframe command path', async () => {
    const iframeTile = page.locator('.video-item:has(iframe)').first();
    await iframeTile.click({ button: 'right' });

    await page.waitForFunction(() => {
      const videos = Array.from(document.querySelectorAll('.video-item video'));
      return videos.length > 0 && videos.some(v => v.muted === false);
    }, { timeout: 12000 });

    await page.click('#globalMuteToggle');
    await page.waitForFunction(() => {
      const label = document.getElementById('globalMuteToggle')?.textContent?.trim() || '';
      const html5Videos = Array.from(document.querySelectorAll('.video-item video'));
      return label === 'Global Mute: ON' && html5Videos.length > 0 && html5Videos.every(v => v.muted === true);
    }, { timeout: 12000 });
    await takeShot(page, '03-global-mute-on.png');

    await page.click('#globalMuteToggle');
    await page.waitForFunction(() => {
      const label = document.getElementById('globalMuteToggle')?.textContent?.trim() || '';
      const html5Videos = Array.from(document.querySelectorAll('.video-item video'));
      return label === 'Global Mute: OFF' && html5Videos.length > 0 && html5Videos.some(v => v.muted === false);
    }, { timeout: 12000 });
    await takeShot(page, '04-global-mute-off.png');

    const hookData = await page.evaluate(() => {
      const commands = Array.isArray(window.__wave8Hooks?.iframeCommands)
        ? window.__wave8Hooks.iframeCommands
        : [];
      const youtubeCalls = commands.filter(item => item.provider === 'youtube');
      return {
        commandCount: commands.length,
        youtubeCalls,
        hasYoutubeMute: youtubeCalls.some(item => item.muted === true),
        hasYoutubeUnmute: youtubeCalls.some(item => item.muted === false)
      };
    });

    if (!hookData.hasYoutubeMute || !hookData.hasYoutubeUnmute) {
      throw new Error(`Missing expected YouTube mute/unmute command path. Hook data: ${JSON.stringify(hookData)}`);
    }

    return hookData;
  });

  await runAssertion('C) Playlist editor stale slot context is cleared and stale write prevented', async () => {
    const selectedTileId = await page.evaluate(() => {
      const iframeTile = document.querySelector('.video-item:has(iframe)');
      if (!iframeTile) return '';
      iframeTile.click();
      return iframeTile.id;
    });

    if (!selectedTileId) {
      throw new Error('No iframe tile found to open slot-scoped playlist editor context.');
    }

    await page.click('#playlistEditorOpenBtn');
    await ensureNotHidden(page, '#playlist-editor-module', 12000);

    const before = await page.evaluate(() => {
      const firstVideo = document.querySelector('.video-item video source');
      return {
        playlistContextBefore: typeof playlistEditorContext !== 'undefined' ? playlistEditorContext : null,
        firstTileSource: firstVideo ? firstVideo.getAttribute('src') : null
      };
    });

    await page.evaluate((tileId) => removeVideo(tileId), selectedTileId);
    await page.waitForFunction((tileId) => !document.getElementById(tileId), selectedTileId, { timeout: 10000 });

    await page.evaluate(() => {
      window.PlaylistEditor.addItems([
        { url: 'https://example.com/stale-write-probe.mp4', title: 'Stale Write Probe' }
      ]);
    });

    await page.waitForTimeout(900);

    const after = await page.evaluate(() => {
      const firstVideo = document.querySelector('.video-item video source');
      return {
        playlistContextAfter: typeof playlistEditorContext !== 'undefined' ? playlistEditorContext : null,
        firstTileSource: firstVideo ? firstVideo.getAttribute('src') : null,
        selectedSlotId: typeof selectedSlotId !== 'undefined' ? selectedSlotId : null
      };
    });

    await takeShot(page, '05-editor-stale-context.png');

    const contextCleared = after.playlistContextAfter === null;
    const staleWritePrevented = before.firstTileSource === after.firstTileSource;
    if (!contextCleared || !staleWritePrevented) {
      throw new Error(`Editor stale-context assertion failed: ${JSON.stringify({ before, after, contextCleared, staleWritePrevented })}`);
    }

    await page.evaluate(() => {
      if (window.PlaylistEditor) {
        window.PlaylistEditor.toggleEditor(false);
        window.PlaylistEditor.toggleStatus(false);
      }
      closeAllModules();
    });

    return { selectedTileId, before, after, contextCleared, staleWritePrevented };
  });

  await runAssertion('D) Dead URL retries then advances to playable next item', async () => {
    await page.evaluate(() => clearAll());
    await page.evaluate(() => {
      if (window.PlaylistEditor) {
        window.PlaylistEditor.toggleEditor(false);
        window.PlaylistEditor.toggleStatus(false);
      }
      closeAllModules();
      toggleGlobalPlaylistModule();
    });

    await page.waitForFunction(() => {
      const module = document.getElementById('globalPlaylistModule');
      return module && getComputedStyle(module).display === 'block';
    }, { timeout: 12000 });

    await page.evaluate(({ deadMp4, mp4 }) => {
      document.getElementById('globalPlaylistInput').value = `${deadMp4}\n${mp4}`;
      document.getElementById('globalSimultaneousCount').value = '1';
    }, TEST_URLS);
    await page.evaluate(() => startGlobalPlaylist());

    await page.waitForFunction(() => Boolean(document.querySelector('.video-item video source')), { timeout: 20000 });

    let advanced = true;
    let failureSnapshot = null;
    try {
      await page.waitForFunction((goodUrl) => {
        const source = document.querySelector('.video-item video source');
        if (!source) return false;
        const src = source.getAttribute('src') || source.src || '';
        return src.includes(goodUrl);
      }, TEST_URLS.mp4, { timeout: 45000 });
    } catch (_) {
      advanced = false;
      failureSnapshot = await page.evaluate(() => {
        const source = document.querySelector('.video-item video source');
        return {
          currentSource: source ? (source.getAttribute('src') || source.src || '') : null,
          isGlobalPlaylistActive: typeof isGlobalPlaylistActive !== 'undefined' ? isGlobalPlaylistActive : null,
          globalPlaylistIndex: typeof globalPlaylistIndex !== 'undefined' ? globalPlaylistIndex : null,
          globalPlaylistLinks: typeof globalPlaylistLinks !== 'undefined' ? globalPlaylistLinks : null,
          slotCount: document.querySelectorAll('.video-item').length
        };
      });
    }

    await takeShot(page, advanced ? '06-dead-url-advanced.png' : '06-dead-url-failure.png');

    if (!advanced) {
      throw new Error(`Did not advance to playable URL within bounded window. Evidence: ${JSON.stringify(failureSnapshot)}`);
    }

    const after = await page.evaluate(() => {
      const source = document.querySelector('.video-item video source');
      return {
        currentSource: source ? (source.getAttribute('src') || source.src || '') : null,
        globalPlaylistIndex: typeof globalPlaylistIndex !== 'undefined' ? globalPlaylistIndex : null
      };
    });

    return { advanced, after };
  });

  await runAssertion('E) Module overlay + fullscreen sanity', async () => {
    await page.evaluate(() => {
      if (window.PlaylistEditor) {
        window.PlaylistEditor.toggleEditor(false);
        window.PlaylistEditor.toggleStatus(false);
      }
      closeAllModules();
      toggleBulkModule();
    });
    await page.waitForFunction(() => {
      const module = document.getElementById('bulkImportModule');
      const overlay = document.getElementById('modalOverlay');
      return module && overlay && getComputedStyle(module).display === 'block' && getComputedStyle(overlay).display === 'block';
    }, { timeout: 12000 });
    await takeShot(page, '07-module-overlay-open.png');

    await page.evaluate(() => closeAllModules());
    await page.waitForFunction(() => {
      const module = document.getElementById('bulkImportModule');
      const overlay = document.getElementById('modalOverlay');
      return module && overlay && getComputedStyle(module).display === 'none' && getComputedStyle(overlay).display === 'none';
    }, { timeout: 12000 });

    await page.evaluate(() => toggleFullscreenMode());
    await page.waitForFunction(() => Boolean(document.fullscreenElement), { timeout: 15000 });
    await page.waitForFunction(() => {
      const toggle = document.getElementById('controlsToggle');
      return document.body.classList.contains('fullscreen-mode') && toggle && toggle.title === 'Exit fullscreen';
    }, { timeout: 12000 });
    await takeShot(page, '08-fullscreen-active.png');

    await page.evaluate(async () => {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (_) {
          // Ignore cleanup failures in automation teardown.
        }
      }
    });

    return {
      fullscreenEntered: await page.evaluate(() => Boolean(document.body.classList.contains('fullscreen-mode')))
    };
  });
} catch (error) {
  runError = toErrorMessage(error);
} finally {
  await page.close({ runBeforeUnload: true }).catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

if (pageVideo) {
  try {
    const generated = await pageVideo.path();
    if (generated && generated !== VIDEO_PATH) {
      await fs.copyFile(generated, VIDEO_PATH);
    }
  } catch (_) {
    // Keep run going even if video copy fails.
  }
}

const totals = {
  total: assertionResults.length,
  passed: assertionResults.filter(item => item.passed).length,
  failed: assertionResults.filter(item => !item.passed).length
};

const payload = {
  runStartedAt,
  runFinishedAt: nowIso(),
  targetUrl: TARGET_URL,
  totals,
  assertions: assertionResults,
  runError,
  logs: {
    pageErrors,
    consoleMessages: consoleMessages.slice(0, 200)
  },
  artifacts: {
    video: path.relative(process.cwd(), VIDEO_PATH).replace(/\\/g, '/'),
    screenshots: capturedScreenshots
      .map(name => path.join(ARTIFACT_DIR, name))
      .map(p => path.relative(process.cwd(), p).replace(/\\/g, '/'))
  }
};

await fs.writeFile(RESULTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const summaryLine = `wave8-live-bugtesting totals: ${totals.passed}/${totals.total} passed, ${totals.failed} failed`;
console.log(summaryLine);
if (runError) {
  console.error(`run-error: ${runError}`);
}

if (totals.failed > 0 || runError) {
  process.exitCode = 1;
}
