/* A/B: run the suites that failed, with the new SI ordering active vs
 * neutralised (identity), to attribute failures to the ordering change. */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUITES = [
  'csPackV2Step2aSelfTest',
  'csPackV2Step5SelfTest',
  'csPackV2Step5dSelfTest',
  'csPackV2Step5eSelfTest',
  'csPackV2Step5fSelfTest',
];

async function runSuites(page, neutralise) {
  await page.evaluate((off) => {
    if (off) {
      window.__siOrigPromote = window.__siOrigPromote
        || window.csPackV2PromoteCriticalRearUnits;
      window.__siOrigReorder = window.__siOrigReorder
        || window.csPackV2ReorderRearPocketOrder;
      window.csPackV2PromoteCriticalRearUnits = (u) => u;
      window.csPackV2ReorderRearPocketOrder = (u) => u;
    } else if (window.__siOrigPromote) {
      window.csPackV2PromoteCriticalRearUnits = window.__siOrigPromote;
      window.csPackV2ReorderRearPocketOrder = window.__siOrigReorder;
    }
  }, neutralise);

  const out = [];
  for (const name of SUITES) {
    const r = await page.evaluate(async (fnName) => {
      try {
        let res = window[fnName]();
        if (res && typeof res.then === 'function') res = await res;
        return {
          ok: !!(res && (res.ok === true || res.ok === undefined)),
          passed: res && res.passed,
          total: res && res.total,
          fails: res && res.results
            ? res.results.filter((x) => x && x.ok === false)
              .slice(0, 6).map((x) => `${x.id}: ${x.detail || ''}`)
            : null,
        };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }, name);
    out.push({ name, ...r });
  }
  return out;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch (_) { /* */ } });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length,
    { timeout: 60000 });
  await sleep(1500);

  const withOrdering = await runSuites(page, false);
  const neutralised = await runSuites(page, true);

  const rows = SUITES.map((n, i) => ({
    suite: n,
    withSiOrdering: `${withOrdering[i].passed}/${withOrdering[i].total}`,
    neutralised: `${neutralised[i].passed}/${neutralised[i].total}`,
    same: withOrdering[i].passed === neutralised[i].passed,
    failsWith: withOrdering[i].fails,
    failsNeutral: neutralised[i].fails,
  }));
  console.log(JSON.stringify(rows, null, 2));
  await browser.close();
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
