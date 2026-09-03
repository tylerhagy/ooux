#!/usr/bin/env node
/*
 * browser-test.mjs — drives the real app in Chromium against a fixture.
 *
 * The File System Access API needs a user gesture and a real folder, so this
 * installs an in-memory folder handle before the module boots. Everything
 * after that point is the actual application code, not a stand-in for it.
 *
 * Playwright is optional. If it cannot be found this exits 0 with a note —
 * test.mjs is the gate that must always run.
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let chromium;
const grab = (m) => (m && m.chromium) || (m && m.default && m.default.chromium) || null;
for (const spec of ['playwright', 'playwright-core', '@playwright/test']) {
  try { chromium = grab(await import(require.resolve(spec))); if (chromium) break; } catch { /* try the next */ }
}
if (!chromium) {
  for (const p of [
    '/Users/thagy/Projects/priority-guide/node_modules/playwright/index.mjs',
    '/Users/thagy/Projects/protoserve/node_modules/playwright/index.mjs',
  ]) {
    try { chromium = grab(await import(p)); if (chromium) break; } catch { /* try the next */ }
  }
}
if (!chromium && process.env.PLAYWRIGHT_PATH) {
  try { chromium = grab(await import(process.env.PLAYWRIGHT_PATH)); } catch { /* still none */ }
}
if (!chromium) {
  console.log('  playwright not available — skipping browser tests');
  process.exit(0);
}

const PORT = 8155;
const FILE = readFileSync(path.join(HERE, 'fixtures', 'library.md'), 'utf8');

const server = spawn('python3', ['serve.py', String(PORT)], { cwd: HERE, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let pass = 0;
const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(`${n}${d ? `\n       ${d}` : ''}`); };
const eq = (n, a, b) => ok(n, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript((text) => {
  const store = { 'library.md': text };
  const fileHandle = (name) => ({
    kind: 'file', name,
    getFile: async () => ({ text: async () => store[name] }),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (t) => { store[name] = t; window.__written = t; },
      close: async () => {},
    }),
  });
  const dir = {
    kind: 'directory', name: 'Library (ORCA)',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    entries: async function* () { for (const n of Object.keys(store)) yield [n, fileHandle(n)]; },
  };
  window.showDirectoryPicker = async () => dir;
  window.__store = store;
}, FILE);

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForSelector('#stage');
await page.click('#fileName');
await page.waitForSelector('.mini', { timeout: 8000 });
await page.click('.mini[data-id="book"]');
await page.waitForSelector('.card', { timeout: 8000 });

const written = () => page.evaluate(() => window.__written || null);
const current = () => page.evaluate(() => window.__store['library.md']);
const isPresent = () => page.evaluate(() => document.body.dataset.present === 'true');
const save = async () => {
  await page.keyboard.down('Meta'); await page.keyboard.press('s'); await page.keyboard.up('Meta');
  await page.waitForTimeout(400);
};
/** Dispatch a synthetic keydown from whatever has focus, the way the global handler actually hears it. */
const key = (k, opts = {}) => page.evaluate(({ k, opts }) => {
  (document.activeElement || document).dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}, { k, opts });

// ---------------------------------------------------------------- opening
ok('the fixture folder opens without a read-only banner', (await page.$('.banner.err')) === null);
eq('both objects are listed in the rail', await page.locator('.rail-row').count(), 2);
eq('opening Book from the rail loads its card', await page.locator('#nameIn').inputValue(), 'Book');

// ---------------------------------------------------------------- present mode: button
ok('present mode starts off', !(await isPresent()));
await page.click('#presentBtn');
await page.waitForTimeout(150);
ok('clicking Present turns it on', await isPresent());
ok('the header and rail hide', !(await page.locator('header').isVisible()));
await page.click('#exitPresent');
await page.waitForTimeout(150);
ok('clicking Exit present turns it back off', !(await isPresent()));

// ---------------------------------------------------------------- present mode: P shortcut
await key('p');
await page.waitForTimeout(150);
ok('pressing P toggles present mode on, the same as the button', await isPresent());
await key('p');
await page.waitForTimeout(150);
ok('pressing P again toggles it back off', !(await isPresent()));
await key('P');
await page.waitForTimeout(150);
ok('capital P (shift held) also toggles it', await isPresent());
ok('Escape still exits present mode', await (async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return !(await isPresent());
})());

ok('Cmd/Ctrl+P is ignored, so it never fights the browser print shortcut',
  await (async () => {
    await key('p', { metaKey: true });
    await page.waitForTimeout(150);
    return !(await isPresent());
  })());

await page.click('#nameIn');
await key('p');
await page.waitForTimeout(150);
ok('P while typing in a field is ignored, not treated as the Present shortcut', !(await isPresent()));
await page.$eval('#nameIn', (n) => n.blur());
eq('the name field is restored', await page.locator('#nameIn').inputValue(), 'Book');

// ---------------------------------------------------------------- capture mode
await key('c');
await page.waitForTimeout(150);
ok('C opens capture', await page.locator('#capScrim').isVisible());
await page.fill('#capName', 'Author');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
eq('capturing an existing object jumps straight to it', await page.locator('#nameIn').inputValue(), 'Author');
ok('the tally counts it', (await page.textContent('#capTally')).includes('1 captured'));

await page.fill('#capName', 'Publisher');
await page.keyboard.press('Enter');
await page.waitForSelector('.dlg');
await page.click('.dlg [data-act=ok]');
await page.waitForTimeout(250);
eq('capturing an unknown name offers to create it, then opens it',
  await page.locator('#nameIn').inputValue(), 'Publisher');
ok('the tally counts the second capture', (await page.textContent('#capTally')).includes('2 captured'));
await page.click('#capDone');
await page.waitForTimeout(150);
ok('Done closes capture', !(await page.locator('#capScrim').isVisible()));

// ---------------------------------------------------------------- card + chip + relationship
await page.locator('.rail-row', { hasText: 'Book' }).locator('.rail-item').click();
await page.waitForTimeout(150);
eq('the rail selects Book', await page.locator('#nameIn').inputValue(), 'Book');
ok('its relationship row shows a chip to Author', await page.locator('.chip:has-text("Author")').isVisible());

await page.locator('.chip:has-text("Author") .tlbl').click();
await page.waitForTimeout(150);
eq('clicking a chip navigates to the target object', await page.locator('#nameIn').inputValue(), 'Author');

await page.locator('.rail-row', { hasText: 'Book' }).locator('.rail-item').click();
await page.waitForTimeout(150);
const chipsBefore = await page.locator('.chip').count();
await page.locator('.addtarget').first().click();
await page.fill('.tgtinput', 'Publisher');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
eq('adding a target relates a new chip', await page.locator('.chip').count(), chipsBefore + 1);
ok('the new chip points at the object just created', await page.locator('.chip:has-text("Publisher")').isVisible());

const beforeUntarget = await current();
await page.locator('.chip:has-text("Publisher") .chipx').click();
await page.waitForTimeout(150);
eq('removing a target drops the chip', await page.locator('.chip').count(), chipsBefore);

// ---------------------------------------------------------------- editing + sign-off
const beforeDef = await page.locator('#defEdit').inputValue();
await page.fill('#defEdit', beforeDef + ' Held in one or more copies.');
await page.locator('#defEdit').blur();
await page.waitForTimeout(150);
ok('the definition can be edited', (await page.locator('#defEdit').inputValue()) !== beforeDef);

const confirmIfAsked = async () => {
  if (await page.locator('.dlg [data-act=ok]').count()) {
    await page.click('.dlg [data-act=ok]');
    await page.waitForTimeout(150);
  }
};
const lock = page.locator('tr[data-idx="0"] .lockbtn').first();
ok('a row can be signed off', await lock.getAttribute('aria-pressed') === 'false');
await lock.click();
await page.waitForTimeout(150);
await confirmIfAsked(); // first sign-off on a file with no Sign-off column yet asks to add one
eq('the sign-off shows as on', await lock.getAttribute('aria-pressed'), 'true');
await lock.click();
await page.waitForTimeout(150);
await confirmIfAsked(); // unlocking a signed row asks for confirmation too
eq('and can be undone', await lock.getAttribute('aria-pressed'), 'false');

// ---------------------------------------------------------------- S toggles Source and back
await page.locator('.rail-row', { hasText: 'Book' }).locator('.rail-item').click();
await page.waitForTimeout(150);
eq('starting back on the Book card', await page.locator('#nameIn').inputValue(), 'Book');

await key('s');
await page.waitForTimeout(150);
ok('S from a Card opens Source', await page.locator('.ln').count() > 0);

await key('s');
await page.waitForTimeout(150);
ok('S again returns to the same Card, not Map', await page.locator('#nameIn').isVisible());
eq('and it is still the Book card', await page.locator('#nameIn').inputValue(), 'Book');

await page.locator('#viewSeg button[data-view="map"]').click();
await page.waitForTimeout(150);
ok('switching to Map shows the map cards', await page.locator('.mini').count() > 0);

await key('s');
await page.waitForTimeout(150);
ok('S from Map opens Source', await page.locator('.ln').count() > 0);

await key('s');
await page.waitForTimeout(150);
ok('S again returns to Map, unchanged from before', await page.locator('.mini').count() > 0);
ok('and not to a Card', await page.locator('#nameIn').count() === 0);

// ---------------------------------------------------------------- save round-trips
await save();
const w = await written();
ok('save wrote the file', !!w);
ok('the edited definition landed in the saved file', w && w.includes('Held in one or more copies.'));
ok('the removed Publisher target did not leave a chip behind in the file',
  w && !/Book[\s\S]*Publisher/.test(w.split('## Author')[0]));

ok('no page errors', errors.length === 0, errors.join(' | '));
console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
await browser.close();
server.kill();
process.exit(fails.length ? 1 : 0);
