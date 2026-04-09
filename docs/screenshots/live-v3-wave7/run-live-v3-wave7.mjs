import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const TEST_URL = 'https://h-town.duckdns.org/gridplay/v3/';
const MP4_URL = 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4';
const HLS_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const ARTIFACT_DIR = path.resolve('docs/screenshots/live-v3-wave7');
const RESULTS_PATH = path.join(ARTIFACT_DIR, 'test-results.json');
const VIDEO_OUT_PATH = path.join(ARTIFACT_DIR, 'session-video.webm');

const startedAt = new Date().toISOString();
const assertions = [];

function nowIso() {
  return new Date().toISOString();
}

function pushAssertion(name, pass, details = {}) {
  assertions.push({
    name,
    pass: Boolean(pass),
    timestamp: nowIso(),
    details
  });
}

async function screenshot(page, fileName) {
  await page.screenshot({ path: path.join(ARTIFACT_DIR, fileName), fullPage: true });
}

function byTopbarButton(page, label) {
  return page.locator('.controls button.btn', { hasText: label }).first();
}

async function getTopbarLabels(page) {
  return page.evaluate(() => {
    const controls = document.querySelector('.controls');
    if (!controls) return [];
    return Array.from(controls.querySelectorAll('button')).map(btn => (btn.textContent || '').trim()).filter(Boolean);
  });
}

async function getHtml5TileAudioStates(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('.video-item')).map(tile => {
      const video = tile.querySelector('video');
      if (!video) return null;
      return {
        tileId: tile.id || null,
        muted: Boolean(video.muted),
        paused: Boolean(video.paused),
        currentTime: Number(video.currentTime || 0)
      };
    }).filter(Boolean);
  });
}

async function waitForTileCount(page, count, timeout = 25000) {
  await page.waitForFunction(
    expected => document.querySelectorAll('.video-item').length >= expected,
    count,
    { timeout }
  );
}

async function run() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: {
      dir: ARTIFACT_DIR,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();
  const pageVideo = page.video();

  let runError = null;

  try {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    await screenshot(page, '01-home.png');

    const topbarLabels = await getTopbarLabels(page);
    const requiredTopbar = ['Add', 'Import / Extract', 'Global Playlist', 'Playlist Editor', 'Global Mute'];
    const missingTopbar = requiredTopbar.filter(label => !topbarLabels.some(item => item.startsWith(label)));
    pushAssertion('A) topbar required buttons visible', missingTopbar.length === 0, {
      topbarLabels,
      missingTopbar
    });

    const urlInput = page.locator('#urlInput');
    await urlInput.fill(MP4_URL);
    await byTopbarButton(page, 'Add').click();
    await waitForTileCount(page, 1);

    const tileCountAfterFirstAdd = await page.locator('.video-item').count();
    pushAssertion('B) add flow creates at least one tile', tileCountAfterFirstAdd >= 1, {
      tileCountAfterFirstAdd,
      addedUrl: MP4_URL
    });

    await urlInput.fill(HLS_URL);
    await byTopbarButton(page, 'Add').click();
    await waitForTileCount(page, 2);
    await page.waitForTimeout(1000);
    await screenshot(page, '02-two-tiles.png');

    const tileCountAfterSecondAdd = await page.locator('.video-item').count();
    const html5StatesAfterSecondAdd = await getHtml5TileAudioStates(page);
    pushAssertion('D0) at least two HTML5 tiles available', tileCountAfterSecondAdd >= 2 && html5StatesAfterSecondAdd.length >= 2, {
      tileCountAfterSecondAdd,
      html5StatesAfterSecondAdd
    });

    const firstTileMenuMain = page.locator('.video-item .tile-menu-main').first();
    await firstTileMenuMain.click();
    await page.waitForTimeout(400);

    const radialState = await page.evaluate(() => {
      const shell = document.querySelector('.video-item .tile-menu-shell.open');
      if (!shell) {
        return { isOpen: false, actions: [] };
      }
      const actions = Array.from(shell.querySelectorAll('.tile-radial-action')).map(btn => (btn.textContent || '').trim());
      return { isOpen: true, actions };
    });
    const requiredRadialActions = ['Q', 'R', 'N', 'F', 'M'];
    const missingRadial = requiredRadialActions.filter(action => !radialState.actions.includes(action));
    pushAssertion('C) radial menu shows required actions', radialState.isOpen && missingRadial.length === 0, {
      radialState,
      missingRadial
    });
    await screenshot(page, '03-radial-menu-open.png');

    const beforeAudioSwitch = await getHtml5TileAudioStates(page);
    const unmutedBefore = beforeAudioSwitch.filter(s => !s.muted).map(s => s.tileId);
    await firstTileMenuMain.click({ button: 'right' });
    await page.waitForTimeout(500);
    const afterAudioSwitch = await getHtml5TileAudioStates(page);
    const unmutedAfter = afterAudioSwitch.filter(s => !s.muted).map(s => s.tileId);
    const audioSwitched = unmutedBefore.join(',') !== unmutedAfter.join(',');
    pushAssertion('D) right-click tile menu switches active audio tile', audioSwitched, {
      beforeAudioSwitch,
      afterAudioSwitch,
      unmutedBefore,
      unmutedAfter
    });

    const globalMuteToggle = page.locator('#globalMuteToggle');
    const beforeGlobalMute = await getHtml5TileAudioStates(page);
    await globalMuteToggle.click();
    await page.waitForTimeout(400);
    const onState = await getHtml5TileAudioStates(page);
    const onLabel = (await globalMuteToggle.innerText()).trim();
    await globalMuteToggle.click();
    await page.waitForTimeout(400);
    const offState = await getHtml5TileAudioStates(page);
    const offLabel = (await globalMuteToggle.innerText()).trim();
    const allMutedOn = onState.length > 0 && onState.every(s => s.muted);
    const changedAfterOff = JSON.stringify(onState.map(s => s.muted)) !== JSON.stringify(offState.map(s => s.muted));
    pushAssertion('E) Global Mute ON/OFF updates muted states', allMutedOn && changedAfterOff, {
      beforeGlobalMute,
      onState,
      offState,
      onLabel,
      offLabel
    });

    await byTopbarButton(page, 'Import / Extract').click();
    await page.waitForTimeout(500);
    const importVisible = await page.evaluate(() => {
      const module = document.getElementById('bulkImportModule');
      if (!module) return false;
      const style = window.getComputedStyle(module);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
    pushAssertion('F) Import/Extract module opens', importVisible, { importVisible });
    await screenshot(page, '04-import-module-open.png');

    await page.evaluate(() => {
      if (typeof window.closeAllModules === 'function') {
        window.closeAllModules();
      }
    });
    await page.waitForFunction(() => {
      const overlay = document.getElementById('modalOverlay');
      return !overlay || window.getComputedStyle(overlay).display === 'none';
    }, { timeout: 10000 });

    const fsBefore = await page.evaluate(() => ({
      fullscreenElement: Boolean(document.fullscreenElement),
      bodyFullscreenClass: document.body.classList.contains('fullscreen-mode'),
      title: (document.getElementById('controlsToggle') || {}).title || ''
    }));
    await page.evaluate(() => {
      const button = document.getElementById('controlsToggle');
      if (button) {
        button.click();
      }
    });
    await page.waitForTimeout(800);
    const fsAfter = await page.evaluate(() => ({
      fullscreenElement: Boolean(document.fullscreenElement),
      bodyFullscreenClass: document.body.classList.contains('fullscreen-mode'),
      title: (document.getElementById('controlsToggle') || {}).title || ''
    }));
    const fullscreenSignalChanged =
      fsBefore.fullscreenElement !== fsAfter.fullscreenElement ||
      fsBefore.bodyFullscreenClass !== fsAfter.bodyFullscreenClass ||
      fsBefore.title !== fsAfter.title;
    pushAssertion('G) fullscreen toggle emits state change signal', fullscreenSignalChanged, {
      fsBefore,
      fsAfter
    });
    await screenshot(page, '05-fullscreen-state.png');
  } catch (error) {
    runError = error;
    pushAssertion('run-level exception', false, {
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await context.close();
    await browser.close();
  }

  const generatedVideoPath = pageVideo ? await pageVideo.path() : null;
  if (generatedVideoPath) {
    await fs.copyFile(generatedVideoPath, VIDEO_OUT_PATH);
    if (path.resolve(generatedVideoPath) !== path.resolve(VIDEO_OUT_PATH)) {
      await fs.unlink(generatedVideoPath).catch(() => {});
    }
  }

  const passCount = assertions.filter(item => item.pass).length;
  const failCount = assertions.length - passCount;

  const report = {
    meta: {
      startedAt,
      finishedAt: nowIso(),
      url: TEST_URL,
      mode: 'playwright-fallback-headless-chromium',
      browserUseAttempted: true,
      browserUseAvailable: true
    },
    totals: {
      assertions: assertions.length,
      passed: passCount,
      failed: failCount
    },
    assertions
  };

  await fs.writeFile(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (runError || failCount > 0) {
    process.exitCode = 1;
  }
}

await run();
