'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('native Choice click retains focus without cancelling its default or change events', {
  skip: !chromium && 'Optional browser regression requires Playwright and its Chromium installation',
}, async () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  const guard = html.match(/\$\('display'\)\.addEventListener\('click',[\s\S]*?\},true\);/);
  assert.ok(guard, 'The native Choice capture guard must be present in the actual launcher');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="display"><div id="awt">
        <select id="choice"><option>First map</option><option>Second map</option></select>
        <canvas id="canvas" width="100" height="100"></canvas>
      </div><textarea id="textentryarea__"></textarea></div>
      <select id="launcher"><option>Original</option><option>Enhanced</option></select>
    `);
    await page.addScriptTag({ content: `
      const $ = id => document.getElementById(id);
      const events = { awtClicks: 0, nativeChanges: 0, bubbledChanges: 0 };
      // Reproduce the enclosing CheerpJ AWT click listener's hidden-input focus.
      $('awt').addEventListener('click', () => {
        events.awtClicks++;
        $('textentryarea__').focus({preventScroll:true});
      });
      $('choice').addEventListener('change', () => { events.nativeChanges++; });
      $('awt').addEventListener('change', () => { events.bubbledChanges++; });
      function choiceClick() {
        $('choice').focus();
        const event = new MouseEvent('click', { bubbles:true, cancelable:true });
        const uncancelled = $('choice').dispatchEvent(event);
        return { active:document.activeElement.id, uncancelled, defaultPrevented:event.defaultPrevented };
      }
    ` });
    const before = await page.evaluate(() => ({ ...choiceClick(), awtClicks: events.awtClicks }));
    assert.deepEqual(before, {
      active: 'textentryarea__', uncancelled: true, defaultPrevented: false, awtClicks: 1,
    }, 'The unguarded fixture must reproduce focus being stolen from the Choice');

    await page.addScriptTag({ content: guard[0] });
    const after = await page.evaluate(() => ({ ...choiceClick(), awtClicks: events.awtClicks }));
    assert.deepEqual(after, {
      active: 'choice', uncancelled: true, defaultPrevented: false, awtClicks: 1,
    }, 'Capture must stop the ancestor click without preventing the native select default');

    await page.selectOption('#choice', { index: 1 });
    assert.deepEqual(await page.evaluate(() => ({
      selected: $('choice').selectedIndex, nativeChanges: events.nativeChanges,
      bubbledChanges: events.bubbledChanges, awtClicks: events.awtClicks,
    })), { selected: 1, nativeChanges: 1, bubbledChanges: 1, awtClicks: 1 },
    'Selecting an option must still reach the Choice peer change listener');

    await page.locator('#canvas').click();
    assert.deepEqual(await page.evaluate(() => ({ active: document.activeElement.id, awtClicks: events.awtClicks })),
      { active: 'textentryarea__', awtClicks: 2 }, 'Ordinary game clicks must still reach AWT focus handling');

    await page.selectOption('#launcher', { index: 1 });
    assert.deepEqual(await page.evaluate(() => ({ selected: $('launcher').selectedIndex, awtClicks: events.awtClicks })),
      { selected: 1, awtClicks: 2 }, 'Launcher controls outside the game display must remain unaffected');
  } finally {
    await browser.close();
  }
});
