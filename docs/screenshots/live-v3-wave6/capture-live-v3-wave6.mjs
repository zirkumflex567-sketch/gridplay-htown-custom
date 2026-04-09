import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetUrl = 'https://h-town.duckdns.org/gridplay/v3/';
const outputDir = __dirname;
const screenshotSteps = [
  { name: '01-home.png', label: 'page loaded' },
  { name: '02-import-module.png', label: 'click Import / Extract button first' },
  { name: '03-global-playlist-module.png', label: 'open Global Playlist module' },
  { name: '04-tile-menu-open.png', label: 'add one direct mp4 URL, then open tile menu radial actions' },
];

const directMp4Url = 'https://www.w3schools.com/html/mov_bbb.mp4';

function timestampNow() {
  return new Date().toISOString();
}

async function tryClick(page, label, candidates) {
  for (const candidate of candidates) {
    try {
      const locator = candidate(page).first();
      await locator.waitFor({ state: 'visible', timeout: 3500 });
      await locator.click({ timeout: 3500 });
      return `clicked ${label} via candidate`;
    } catch {
      // continue trying fallbacks
    }
  }
  throw new Error(`Unable to click ${label}`);
}

async function fillMp4Url(page, url) {
  const candidates = [
    (p) => p.getByPlaceholder(/https?:\/\//i),
    (p) => p.getByPlaceholder(/url|mp4|video|link|stream/i),
    (p) => p.locator('input[type="url"]'),
    (p) => p.locator('input[type="text"]'),
    (p) => p.locator('textarea'),
  ];

  for (const candidate of candidates) {
    try {
      const locator = candidate(page).first();
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      await locator.fill(url, { timeout: 3000 });
      return 'filled direct mp4 URL';
    } catch {
      // continue trying fallbacks
    }
  }

  throw new Error('Unable to find a URL input field to fill direct mp4 URL');
}

async function clickLikelyAdd(page) {
  const addCandidates = [
    (p) => p.getByRole('button', { name: /add|load|insert|submit|play|open|import|extract/i }),
    (p) => p.locator('button:has-text("Add")'),
    (p) => p.locator('button:has-text("Load")'),
    (p) => p.locator('button:has-text("Import")'),
  ];

  for (const candidate of addCandidates) {
    try {
      const locator = candidate(page).first();
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      await locator.click({ timeout: 3000 });
      return 'clicked add/load button for mp4 URL';
    } catch {
      // continue trying fallbacks
    }
  }

  return 'no add/load button clicked; URL may auto-apply';
}

async function openTileMenu(page) {
  const menuCandidates = [
    (p) => p.getByRole('button', { name: /tile menu|menu|radial|actions|more|options/i }),
    (p) => p.locator('[aria-label*="menu" i]'),
    (p) => p.locator('[title*="menu" i]'),
    (p) => p.locator('button:has-text("...")'),
    (p) => p.locator('button:has-text("⋮")'),
  ];

  for (const candidate of menuCandidates) {
    try {
      const locator = candidate(page).first();
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      await locator.click({ timeout: 3000 });
      return 'opened tile menu via explicit menu button';
    } catch {
      // continue trying fallbacks
    }
  }

  const tileLike = page.locator('video, canvas, .tile, [class*="tile" i]').first();
  await tileLike.waitFor({ state: 'visible', timeout: 4000 });
  await tileLike.click({ button: 'right', timeout: 3000 });
  return 'opened tile menu via right click on first tile';
}

function notesLine(name, pass, detail) {
  return `- ${name}: ${pass ? 'PASS' : 'FAIL'}${detail ? ` - ${detail}` : ''}`;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const startedAt = timestampNow();
  const commandsUsed = process.env.COMMANDS_USED || 'npx -y -p playwright node docs/screenshots/live-v3-wave6/capture-live-v3-wave6.mjs';

  const stepResults = [];
  let mode = 'headful';
  let modeNote = '';
  let browser;

  try {
    browser = await chromium.launch({ headless: false });
  } catch (error) {
    mode = 'headless';
    modeNote = `Headful launch failed: ${error?.message || error}`;
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await page.screenshot({ path: path.join(outputDir, screenshotSteps[0].name), fullPage: true });
    stepResults.push({ name: screenshotSteps[0].name, pass: true, detail: 'Loaded target URL and captured screenshot.' });
  } catch (error) {
    stepResults.push({ name: screenshotSteps[0].name, pass: false, detail: error?.message || String(error) });
  }

  try {
    const detail = await tryClick(page, 'Import/Extract', [
      (p) => p.locator('button[onclick="toggleBulkModule()"]'),
      (p) => p.getByRole('button', { name: /import|extract/i }),
      (p) => p.getByText(/import|extract/i),
    ]);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outputDir, screenshotSteps[1].name), fullPage: true });
    stepResults.push({ name: screenshotSteps[1].name, pass: true, detail });
  } catch (error) {
    try {
      await page.screenshot({ path: path.join(outputDir, screenshotSteps[1].name), fullPage: true });
    } catch {
      // ignore secondary screenshot failure
    }
    stepResults.push({ name: screenshotSteps[1].name, pass: false, detail: error?.message || String(error) });
  }

  try {
    await page.evaluate(() => {
      if (typeof window.closeAllModules === 'function') {
        window.closeAllModules();
      }
    });
    await page.waitForTimeout(300);
    const detail = await tryClick(page, 'Global Playlist module', [
      (p) => p.locator('button[onclick="toggleGlobalPlaylistModule()"]'),
      (p) => p.getByRole('button', { name: /global playlist/i }),
      (p) => p.getByText(/global playlist/i),
    ]);
    await page.waitForSelector('#globalPlaylistModule[style*="display: block"], #globalPlaylistModule[style*="display:block"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outputDir, screenshotSteps[2].name), fullPage: true });
    stepResults.push({ name: screenshotSteps[2].name, pass: true, detail });
  } catch (error) {
    try {
      await page.screenshot({ path: path.join(outputDir, screenshotSteps[2].name), fullPage: true });
    } catch {
      // ignore secondary screenshot failure
    }
    stepResults.push({ name: screenshotSteps[2].name, pass: false, detail: error?.message || String(error) });
  }

  try {
    await page.evaluate(() => {
      if (typeof window.closeAllModules === 'function') {
        window.closeAllModules();
      }
    });
    await page.waitForTimeout(300);

    const urlInput = page.locator('#urlInput');
    await urlInput.waitFor({ state: 'visible', timeout: 8000 });
    await urlInput.fill(directMp4Url);
    const fillDetail = 'filled #urlInput with direct mp4 URL';

    const addButton = page.locator('button[onclick="addFromInputSmart()"]');
    await addButton.click({ timeout: 5000 });
    const addDetail = 'clicked Add button (addFromInputSmart)';

    await page.waitForTimeout(1500);
    const menuButton = page.locator('.tile-menu-main').first();
    await menuButton.waitFor({ state: 'visible', timeout: 12000 });
    await menuButton.click({ timeout: 5000 });
    const radialButton = page.locator('.tile-menu-shell.open .tile-radial-action').first();
    await radialButton.waitFor({ state: 'visible', timeout: 5000 });
    const menuDetail = 'opened tile radial menu via .tile-menu-main click';
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outputDir, screenshotSteps[3].name), fullPage: true });
    stepResults.push({ name: screenshotSteps[3].name, pass: true, detail: `${fillDetail}; ${addDetail}; ${menuDetail}` });
  } catch (error) {
    try {
      await page.screenshot({ path: path.join(outputDir, screenshotSteps[3].name), fullPage: true });
    } catch {
      // ignore secondary screenshot failure
    }
    stepResults.push({ name: screenshotSteps[3].name, pass: false, detail: error?.message || String(error) });
  }

  await context.close();
  await browser.close();

  const endedAt = timestampNow();
  const lines = [
    '# Live v3 Smoke Screenshot Run (wave6)',
    '',
    `- timestamp_start: ${startedAt}`,
    `- timestamp_end: ${endedAt}`,
    `- commands_used: ${commandsUsed}`,
    `- mode: ${mode}`,
    `- mode_note: ${modeNote || 'headful launch succeeded'}`,
    `- test_urls: ${targetUrl}`,
    '',
    '## Screenshot Step Notes',
    ...stepResults.map((s) => notesLine(s.name, s.pass, s.detail)),
    '',
    '## Output Files',
    ...screenshotSteps.map((s) => `- ${s.name}`),
  ];

  await fs.writeFile(path.join(outputDir, 'README.md'), `${lines.join('\n')}\n`, 'utf8');
}

main().catch(async (error) => {
  const fallback = [
    '# Live v3 Smoke Screenshot Run (wave6)',
    '',
    `- timestamp: ${timestampNow()}`,
    `- commands_used: ${process.env.COMMANDS_USED || 'npx -y -p playwright node docs/screenshots/live-v3-wave6/capture-live-v3-wave6.mjs'}`,
    `- mode: unknown`,
    `- test_urls: ${targetUrl}`,
    '',
    '## Screenshot Step Notes',
    `- run: FAIL - ${error?.stack || error?.message || String(error)}`,
  ].join('\n');

  try {
    await fs.writeFile(path.join(outputDir, 'README.md'), `${fallback}\n`, 'utf8');
  } catch {
    // ignore secondary failure
  }

  console.error(error);
  process.exit(1);
});
