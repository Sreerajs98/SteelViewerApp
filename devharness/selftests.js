/* Runs the viewer's own self-test suites in the loaded app and reports
 * pass/fail per suite, so product changes can be checked for regressions.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('dialog', async d => { await d.dismiss(); });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length,
    { timeout: 60000 });
  await sleep(1500);

  const names = await page.evaluate(() => {
    const out = [];
    for (const k in window) {
      if (/SelfTest$|SelfTests$/.test(k) && typeof window[k] === 'function') out.push(k);
    }
    return out.sort();
  });
  console.log(`found ${names.length} self-test entry points\n`);

  const results = [];
  for (const name of names) {
    const r = await page.evaluate(async (fnName) => {
      const t0 = Date.now();
      try {
        let res = window[fnName]();
        if (res && typeof res.then === 'function') res = await res;
        return {
          ok: !!(res && (res.ok === true || res.ok === undefined)),
          passed: res && res.passed, total: res && res.total,
          failed: res && res.failed,
          fails: res && res.results
            ? res.results.filter(x => x && x.ok === false)
              .slice(0, 6).map(x => `${x.id}: ${x.detail || ''}`)
            : null,
          ms: Date.now() - t0,
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e), ms: Date.now() - t0 };
      }
    }, name).catch(e => ({ ok: false, error: 'eval: ' + e.message }));
    results.push({ name, ...r });
    const tag = r.ok ? 'PASS' : 'FAIL';
    const score = (r.passed != null && r.total != null) ? ` ${r.passed}/${r.total}` : '';
    console.log(`${tag} ${name}${score}${r.error ? '  ERR ' + r.error : ''}`
      + (r.ms != null ? `  (${r.ms}ms)` : ''));
    if (!r.ok && r.fails && r.fails.length) r.fails.forEach(f => console.log('       ' + f));
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} suites passed`);
  if (failed.length) console.log('failing: ' + failed.map(r => r.name).join(', '));
  fs.writeFileSync(path.join(__dirname, 'shots', 'selftests.json'),
    JSON.stringify(results, null, 2), 'utf8');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
