#!/usr/bin/env node
/*
 * Visual QA for champ-patyatawee blog posts.
 *
 * Usage:
 *   node qa-blog.js "file:///D:/Champ/champ-patyatawee/blog/My-Post.html"
 *   node qa-blog.js "https://champ.patyatawee.com/blog/My-Post" ./qa/my-post
 *
 * Environment:
 *   BROWSEROS_CDP=http://127.0.0.1:9110
 *   PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright
 *
 * Example on this machine:
 *   set PLAYWRIGHT_MODULE=C:\Users\C\Documents\Codex\2026-11-08\io-x20\work\k3s-shots\node_modules\playwright
 */
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
  ].filter(Boolean);

  const failures = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(candidate + ': ' + error.message);
    }
  }
  throw new Error(
    'Playwright is not available. Set PLAYWRIGHT_MODULE to a Playwright installation.\n' +
    failures.join('\n')
  );
}

const { chromium } = loadPlaywright();

const url = process.argv[2];
if (!url) {
  console.error('Usage: node qa-blog.js <html-or-http-url> [output-directory]');
  process.exit(2);
}

const cdp = process.env.BROWSEROS_CDP || 'http://127.0.0.1:9110';
const slug = (() => {
  try {
    const parsed = new URL(url);
    return path.basename(parsed.pathname, '.html') || 'blog';
  } catch {
    return 'blog';
  }
})();
const outDir = path.resolve(process.argv[3] || path.join('blog-qa', slug));
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error('BrowserOS Neo has no browser context.');

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || 'request failed',
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);

  let mermaidError = null;
  try {
    await page.waitForSelector('.mermaid svg', { timeout: 15000 });
  } catch (error) {
    mermaidError = error.message;
  }

  const desktop = await page.evaluate(() => {
    const images = Array.from(document.images).map(image => ({
      src: image.getAttribute('src'),
      ok: image.complete && image.naturalWidth > 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    const uniqueSources = [...new Set(images.map(image => image.src))];
    return {
      title: document.title,
      h1: document.querySelector('h1')?.innerText || null,
      headings: Array.from(document.querySelectorAll('h2'))
        .map(heading => heading.innerText.trim())
        .filter(Boolean),
      images,
      uniqueImageSources: uniqueSources,
      brokenImages: images.filter(image => !image.ok),
      codeBlocks: document.querySelectorAll('pre code').length,
      mermaidSvg: document.querySelectorAll('.mermaid svg').length,
      textLength: document.body.innerText.length,
    };
  });

  await page.screenshot({ path: path.join(outDir, 'desktop-top.png') });

  for (const [fileName, heading] of [
    ['desktop-step1.png', 'Step 1'],
    ['desktop-step6.png', 'Step 6'],
    ['desktop-production.png', 'Production checklist'],
  ]) {
    const locator = page.getByText(heading, { exact: false }).first();
    if (await locator.count()) {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, fileName) });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mobile = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  await page.screenshot({ path: path.join(outDir, 'mobile-top.png') });

  const report = {
    url,
    cdp,
    outDir,
    desktop,
    mobile,
    consoleErrors,
    pageErrors,
    failedRequests,
    mermaidError,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    title: desktop.title,
    h1: desktop.h1,
    headings: desktop.headings.length,
    images: desktop.images.length,
    uniqueImages: desktop.uniqueImageSources.length,
    brokenImages: desktop.brokenImages.length,
    codeBlocks: desktop.codeBlocks,
    mermaidSvg: desktop.mermaidSvg,
    mobileOverflow: mobile.overflow,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    failedRequests: failedRequests.length,
    outDir,
  }, null, 2));

  await page.close();

  const failed =
    desktop.brokenImages.length > 0 ||
    desktop.mermaidSvg !== 1 ||
    desktop.codeBlocks === 0 ||
    mobile.overflow ||
    pageErrors.length > 0 ||
    mermaidError;

  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error('QA failed:', error.message);
  process.exit(1);
});
