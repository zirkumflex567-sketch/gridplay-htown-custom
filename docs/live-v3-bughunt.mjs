import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://h-town.duckdns.org/gridplay/v3/';
const SHOT_DIR = path.resolve('C:/gridplay-htown-custom/docs/screenshots/live-v3-bughunt');
const VALID_A = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const VALID_B = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const DEAD_URL = 'https://example.com/definitely-not-a-real-video-404.mp4';

await fs.mkdir(SHOT_DIR, { recursive: true });

const defects = [];
const coverage = [];
const pageErrors = [];
let runError = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowStamp() {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required']
});

const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1400, height: 900 }
});

const page = await context.newPage();

page.on('pageerror', error => {
  pageErrors.push(String(error && error.message ? error.message : error));
});

page.on('console', msg => {
  if (msg.type() === 'error') {
    pageErrors.push(`[console] ${msg.text()}`);
  }
});

async function screenshot(name) {
  const filePath = path.join(SHOT_DIR, `${nowStamp()}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function clickAdd() {
  await page.locator('.controls button').filter({ hasText: 'Add' }).first().click();
}

async function addInput(value) {
  await page.fill('#urlInput', value);
  await clickAdd();
}

async function videoCount() {
  return page.locator('.video-item').count();
}

async function clearAllVideos() {
  await ensureNoModalOverlay();
  await ensurePlaylistEditorClosed();
  await page.locator('button[onclick="clearAll()"]').click();
  await sleep(300);
}

async function ensureNoModalOverlay() {
  await page.evaluate(() => {
    const overlay = document.getElementById('modalOverlay');
    const visible = (overlay?.style.display || '') === 'block';
    if (!visible) {
      return;
    }
    if (typeof window.closeAllModules === 'function') {
      window.closeAllModules();
      return;
    }
    overlay?.click();
  });
  await sleep(180);
}

async function ensurePlaylistEditorClosed() {
  await page.evaluate(() => {
    if (!window.PlaylistEditor) {
      return;
    }
    if (typeof window.PlaylistEditor.toggleEditor === 'function') {
      window.PlaylistEditor.toggleEditor(false);
    }
    if (typeof window.PlaylistEditor.toggleStatus === 'function') {
      window.PlaylistEditor.toggleStatus(false);
    }
  });
  await sleep(120);
}

async function notificationTexts() {
  return page.$$eval('.notification', nodes => nodes.map(node => node.textContent ? node.textContent.trim() : '').filter(Boolean));
}

async function waitForNotification(regex, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const texts = await notificationTexts();
    if (texts.some(t => regex.test(t))) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

async function selectedSlotState() {
  return page.evaluate(() => ({
    selectedClassCount: document.querySelectorAll('.video-item.selected-slot').length,
    slotSelectValue: document.getElementById('slotSelect')?.value || ''
  }));
}

async function recordDefect(title, repro, observed, expected, shotName) {
  const shot = await screenshot(shotName);
  defects.push({ title, repro, observed, expected, screenshot: shot });
}

try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1200);

  coverage.push('Loaded live GridPlay v3 and initialized base UI checks');

  // 1) Invalid URL + Add behavior
  {
    const before = await videoCount();
    await addInput('not-a-url');
    const warned = await waitForNotification(/No valid URLs found/i, 2500);
    const after = await videoCount();
    coverage.push('Tested invalid URL submission via Add button');
    if (!warned || before !== after) {
      await recordDefect(
        'Invalid URL handling is inconsistent',
        ['Enter `not-a-url` into URL input', 'Click `Add`'],
        `warningShown=${warned}, videoCount before=${before}, after=${after}`,
        'Should warn user and avoid creating/changing tiles',
        'invalid-url-behavior'
      );
    }
  }

  // 2) Add many links + selected slot edge handling
  {
    await clearAllVideos();
    await addInput(VALID_A);
    await page.waitForSelector('.video-item', { timeout: 10000 });
    const tile = page.locator('.video-item').first();
    const tileId = await tile.getAttribute('id');
    if (tileId) {
      await page.selectOption('#slotSelect', tileId);
    } else {
      await tile.click();
    }
    await addInput(`${VALID_B}\n${VALID_A}\n${VALID_B}`);
    await sleep(1200);
    const countAfterPlaylistAdd = await videoCount();

    await tile.locator('.video-remove').click({ force: true });
    await sleep(350);
    const stateAfterRemove = await selectedSlotState();
    coverage.push('Tested multi-link add into selected slot and selected-slot removal cleanup');

    if (countAfterPlaylistAdd !== 1 || stateAfterRemove.selectedClassCount !== 0 || stateAfterRemove.slotSelectValue !== '') {
      await recordDefect(
        'Selected slot state cleanup fails after edge operations',
        [
          'Add one valid direct media URL',
          'Select that tile',
          'Add three URLs in one input block',
          'Remove selected tile'
        ],
        `videoCountAfterPlaylistAdd=${countAfterPlaylistAdd}, selectedClassCount=${stateAfterRemove.selectedClassCount}, slotSelectValue='${stateAfterRemove.slotSelectValue}'`,
        'Should keep one tile while queueing, then fully clear selected state when tile is removed',
        'selected-slot-edge-cases'
      );
    }
  }

  // 3) Global mute with mixed html5 + iframe tiles
  {
    await clearAllVideos();
    await addInput(YT_URL);
    await addInput(VALID_A);
    await page.waitForSelector('.video-item', { timeout: 10000 });
    await sleep(1500);

    await page.click('#globalMuteToggle');
    await sleep(600);

    const mixedMuteState = await page.evaluate(() => {
      const buttonText = document.getElementById('globalMuteToggle')?.textContent?.trim() || '';
      const html5Muted = Array.from(document.querySelectorAll('.video-item video')).map(v => v.muted);
      const iframeSrcs = Array.from(document.querySelectorAll('.video-item iframe')).map(f => f.getAttribute('src') || '');
      const hasIframeMuteParam = iframeSrcs.every(src => /[?&]mute=1\b/i.test(src));
      return {
        buttonText,
        html5Count: html5Muted.length,
        html5AllMuted: html5Muted.length > 0 ? html5Muted.every(Boolean) : false,
        iframeCount: iframeSrcs.length,
        hasIframeMuteParam
      };
    });

    coverage.push('Tested global mute against mixed HTML5 + iframe tiles');

    if (mixedMuteState.iframeCount > 0 && !mixedMuteState.hasIframeMuteParam) {
      await recordDefect(
        'Global mute does not mute iframe-based tiles',
        [
          'Add one YouTube tile and one direct HTML5 video tile',
          'Toggle `Global Mute` to ON'
        ],
        `Button='${mixedMuteState.buttonText}', html5AllMuted=${mixedMuteState.html5AllMuted}, iframeCount=${mixedMuteState.iframeCount}, iframeMuteParamPresent=${mixedMuteState.hasIframeMuteParam}`,
        'Global mute ON should mute all playable tiles (or clearly indicate HTML5-only scope)',
        'global-mute-mixed-tiles'
      );
    }
  }

  // 4) Fullscreen enter/exit 5 cycles + topbar state consistency
  {
    let fullscreenIssue = '';
    let fullscreenUnsupported = false;
    for (let i = 0; i < 5; i += 1) {
      await page.click('#controlsToggle', { force: true });
      await sleep(450);

      const entered = await page.evaluate(() => Boolean(document.fullscreenElement));
      if (!entered) {
        fullscreenUnsupported = true;
        break;
      }

      await sleep(1100);
      await page.click('#controlsToggle', { force: true });
      await sleep(450);

      const state = await page.evaluate(() => ({
        fullscreen: Boolean(document.fullscreenElement),
        bodyClass: document.body.classList.contains('fullscreen-mode'),
        controlsHidden: document.querySelector('.controls')?.classList.contains('fs-hidden') || false,
        toggleLabel: document.getElementById('controlsToggle')?.getAttribute('aria-label') || ''
      }));

      if (state.fullscreen || state.bodyClass || state.controlsHidden || state.toggleLabel !== 'Enter fullscreen') {
        fullscreenIssue = `Inconsistent UI state after exit at cycle ${i + 1}: ${JSON.stringify(state)}`;
        break;
      }
    }

    coverage.push('Ran 5 fullscreen enter/exit cycles and checked topbar/toggle consistency');

    if (fullscreenUnsupported) {
      coverage.push('Fullscreen API unavailable in current automated browser mode; fullscreen state test marked inconclusive');
    } else if (fullscreenIssue) {
      await recordDefect(
        'Fullscreen state does not consistently reset after repeated toggles',
        ['Click fullscreen toggle on/off repeatedly for 5 cycles'],
        fullscreenIssue,
        'After each exit: no fullscreen classes, controls visible, toggle label reset to Enter fullscreen',
        'fullscreen-cycles'
      );
    }
  }

  // 5) Rapid module open/close and overlay consistency
  {
    const moduleFns = [
      'toggleBulkModule',
      'toggleGlobalPlaylistModule',
      'toggleSearchPlaylistModule',
      'togglePawgMixModule',
      'toggleBulkModule',
      'toggleSearchPlaylistModule',
      'toggleGlobalPlaylistModule'
    ];

    let moduleIssue = '';

    for (const fnName of moduleFns) {
      await page.evaluate(name => {
        if (typeof window[name] === 'function') {
          window[name]();
        }
      }, fnName);
      await sleep(120);
      const state = await page.evaluate(() => {
        const modules = [
          'bulkImportModule',
          'globalPlaylistModule',
          'searchPlaylistModule',
          'pawgMixModule'
        ];
        const visible = modules.filter(id => (document.getElementById(id)?.style.display || '') === 'block');
        const overlayVisible = (document.getElementById('modalOverlay')?.style.display || '') === 'block';
        return { visible, overlayVisible };
      });

      if (state.visible.length !== 1 || !state.overlayVisible) {
        moduleIssue = `After invoking '${fnName}': visibleModules=${state.visible.join(',')}, overlayVisible=${state.overlayVisible}`;
        break;
      }
    }

    await page.evaluate(() => {
      if (typeof window.closeAllModules === 'function') {
        window.closeAllModules();
      } else {
        document.getElementById('modalOverlay')?.click();
      }
    });
    await sleep(160);
    const afterClose = await page.evaluate(() => {
      const modules = [
        'bulkImportModule',
        'globalPlaylistModule',
        'searchPlaylistModule',
        'pawgMixModule'
      ];
      const visible = modules.filter(id => (document.getElementById(id)?.style.display || '') === 'block');
      const overlayVisible = (document.getElementById('modalOverlay')?.style.display || '') === 'block';
      return { visible, overlayVisible };
    });

    coverage.push('Rapidly switched Import/Global/Search/PAWG modules and verified overlay state');

    if (!moduleIssue && (afterClose.visible.length !== 0 || afterClose.overlayVisible)) {
      moduleIssue = `After overlay close: visibleModules=${afterClose.visible.join(',')}, overlayVisible=${afterClose.overlayVisible}`;
    }

    if (moduleIssue) {
      await recordDefect(
        'Module overlay state becomes inconsistent during rapid toggling',
        [
          'Open Import/Global/Search/PAWG modules rapidly',
          'Close via overlay click'
        ],
        moduleIssue,
        'Exactly one module should be visible when opened; none visible and overlay hidden when closed',
        'module-overlay-consistency'
      );
    }
  }

  // 6) Playlist Editor edge cases
  {
    await clearAllVideos();
    await page.click('#playlistEditorOpenBtn');
    const noSelectionWarning = await waitForNotification(/Select a tile or activate Global Playlist first/i, 2500);

    await addInput(VALID_A);
    const tile = page.locator('.video-item').first();
    const tileIdForEditor = await tile.getAttribute('id');
    if (tileIdForEditor) {
      await page.selectOption('#slotSelect', tileIdForEditor);
    } else {
      await tile.click();
    }
    await page.click('#playlistEditorOpenBtn');
    await sleep(400);
    const editorVisible = await page.evaluate(() => !document.getElementById('playlist-editor-module')?.classList.contains('hidden'));

    await tile.locator('.video-remove').click({ force: true });
    await sleep(250);
    await page.evaluate((url) => {
      if (window.PlaylistEditor && typeof window.PlaylistEditor.addItems === 'function') {
        window.PlaylistEditor.addItems([{ url, title: 'Custom Link', source: 'Manual', views: 0, rating: 0 }]);
      }
    }, VALID_B);
    await sleep(700);
    const removedSlotWarning = await waitForNotification(/Selected tile is no longer available/i, 3000);

    await page.evaluate(() => {
      if (window.PlaylistEditor && typeof window.PlaylistEditor.toggleEditor === 'function') {
        window.PlaylistEditor.toggleEditor(false);
      }
    });
    await sleep(180);

    await ensureNoModalOverlay();
    await page.locator('.global-controls button').filter({ hasText: 'Global Playlist' }).click();
    await page.fill('#globalPlaylistInput', `${VALID_A}\n${VALID_B}`);
    await page.fill('#globalSimultaneousCount', '1');
    await page.click('#globalStartBtn');
    await sleep(1300);

    await page.click('#playlistEditorOpenBtn');
    await sleep(400);

    await page.evaluate(() => {
      if (window.PlaylistEditor) {
        window.PlaylistEditor.setQueue([], 0);
        if (typeof window.PlaylistEditor.notifyChange === 'function') {
          window.PlaylistEditor.notifyChange();
        }
      }
    });
    const clearedWarning = await waitForNotification(/Global Playlist queue cleared from editor/i, 3000);
    const globalButtonText = await page.locator('.global-controls button').filter({ hasText: /Global Playlist/ }).first().textContent();

    coverage.push('Exercised Playlist Editor with no selection, removed selected slot, and active global playlist edits');

    if (!noSelectionWarning || !editorVisible || !removedSlotWarning || !clearedWarning || /Active/i.test(globalButtonText || '')) {
      await recordDefect(
        'Playlist Editor context handling breaks in edge cases',
        [
          'Open Playlist Editor with no selected tile',
          'Open for selected tile then remove tile and edit queue',
          'Open during active Global Playlist and clear queue'
        ],
        `noSelectionWarning=${noSelectionWarning}, editorVisible=${editorVisible}, removedSlotWarning=${removedSlotWarning}, clearedWarning=${clearedWarning}, globalButtonText='${(globalButtonText || '').trim()}'`,
        'Warnings and context transitions should remain valid across all three edge scenarios',
        'playlist-editor-edge-cases'
      );
    }

    await ensurePlaylistEditorClosed();
  }

  // 7) Radial menu drag near boundaries + viewport resize reachability
  {
    if (await videoCount() === 0) {
      await addInput(VALID_A);
      await page.waitForSelector('.video-item', { timeout: 10000 });
    }

    const menuButton = page.locator('.video-item .tile-menu-main').first();
    const start = await menuButton.boundingBox();
    const tileBox = await page.locator('.video-item').first().boundingBox();

    let radialIssue = '';
    if (!start || !tileBox) {
      radialIssue = 'Could not locate tile radial menu controls.';
    } else {
      await page.keyboard.down('Shift');
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(tileBox.x + 3, tileBox.y + 3, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await sleep(200);

      await page.setViewportSize({ width: 375, height: 667 });
      await sleep(300);
      await page.setViewportSize({ width: 1280, height: 720 });
      await sleep(300);

      const reachability = await menuButton.boundingBox();
      if (!reachability) {
        radialIssue = 'Radial menu button disappeared after resize.';
      } else if (reachability.x < 0 || reachability.y < 0 || reachability.x + reachability.width > 1280 || reachability.y + reachability.height > 720) {
        radialIssue = `Radial button out of viewport after resize: ${JSON.stringify(reachability)}`;
      }
    }

    coverage.push('Dragged radial menu to boundary, resized viewport, and checked control reachability');

    if (radialIssue) {
      await recordDefect(
        'Radial tile menu can become unreachable after drag/resize sequence',
        [
          'Shift-drag tile menu near tile boundary',
          'Resize viewport to mobile then desktop'
        ],
        radialIssue,
        'Menu control should remain visible and reachable after responsive resize',
        'radial-menu-boundary-resize'
      );
    }
  }

  // 8) Dead media URL retry/failure handling
  {
    await clearAllVideos();
    await addInput(VALID_A);
    const tile = page.locator('.video-item').first();
    const tileIdForRetry = await tile.getAttribute('id');
    if (tileIdForRetry) {
      await page.selectOption('#slotSelect', tileIdForRetry);
    } else {
      await tile.click();
    }

    const initialNotifCount = (await notificationTexts()).length;
    await addInput(`${DEAD_URL}\n${VALID_B}`);

    let progressed = false;
    let peakNotificationCount = initialNotifCount;
    const deadline = Date.now() + 42000;

    while (Date.now() < deadline) {
      const srcState = await page.evaluate(() => {
        const firstTile = document.querySelector('.video-item video source');
        return firstTile ? (firstTile.getAttribute('src') || '') : '';
      });

      const nCount = (await notificationTexts()).length;
      if (nCount > peakNotificationCount) {
        peakNotificationCount = nCount;
      }

      if (srcState.includes('BigBuckBunny.mp4')) {
        progressed = true;
        break;
      }

      await sleep(500);
    }

    coverage.push('Injected dead media URL and observed retry/skip progression and notification pressure');

    if (!progressed || peakNotificationCount - initialNotifCount > 4) {
      await recordDefect(
        'Dead media retry/skip handling is unstable',
        [
          'Select a tile',
          'Queue dead direct media URL followed by a valid URL',
          'Observe retry/skip behavior for ~40s'
        ],
        `progressedToNext=${progressed}, initialNotifCount=${initialNotifCount}, peakNotifCount=${peakNotificationCount}`,
        'Should eventually advance to next playable URL without notification spam',
        'dead-media-retry-path'
      );
    }
  }
} catch (error) {
  runError = String(error && error.stack ? error.stack : error);
} finally {
  await context.close();
  await browser.close();
}

const uniquePageErrors = Array.from(new Set(pageErrors)).slice(0, 20);

console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  defects,
  coverage,
  runError,
  pageErrors: uniquePageErrors,
  screenshotDir: SHOT_DIR
}, null, 2));
