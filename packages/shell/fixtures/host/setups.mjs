// The page setups the probe rows of hostProbes.json name: what has to happen on a page before a
// row's element exists or is in the state the row probes. Every setup lives here once, so the
// viewer specs, the Trace specs and the stack probe drive a page the same way.
//
// Plain ESM, duck-typed on the part of Playwright's API that a Page and a Frame share (`locator`,
// `getByRole`, `url`, `goto`), so this package needs no Playwright dependency and a setup also
// runs inside an iframe. Code that has to run in the page goes through a locator's `evaluate`,
// which both have too. The exports are string-named after the values of a row's `setup` array.

/**
 * @typedef {object} LocatorLike
 * @property {() => LocatorLike} first
 * @property {(options?: object) => Promise<void>} click
 * @property {(options?: object) => Promise<void>} hover
 * @property {(options?: object) => Promise<void>} focus
 * @property {(value: string, options?: object) => Promise<void>} fill
 * @property {(key: string, options?: object) => Promise<void>} press
 * @property {(options?: object) => Promise<void>} waitFor
 * @property {(options?: object) => Promise<boolean>} isDisabled
 * @property {(selector: string) => LocatorLike} locator
 * @property {(pageFunction: Function, arg?: unknown) => Promise<unknown>} evaluate Runs
 *   `pageFunction(element, arg)` in the page; the synthetic tab drag needs it.
 */

/**
 * @typedef {object} PageLike
 * @property {(selector: string) => LocatorLike} locator
 * @property {(role: string, options?: object) => LocatorLike} getByRole
 * @property {() => string} url
 * @property {(url: string, options?: object) => Promise<unknown>} goto
 */

/**
 * @typedef {object} SetupContext
 * @property {LocatorLike} locator The row's own element (first match of its selector).
 * @property {string} [theme] The theme id the page was opened with.
 * @property {(path: string) => Promise<unknown>} [goto] Opens a page path of hostProbes.json;
 *   supply it where the app is served under a prefix. Default: `page.goto(path)`.
 */

/** The page of the write-dialog rows; `{theme}` is the theme id. */
export const WRITE_PROBE_PAGE = '/embed/drafts/write-probe?embedded=true&theme={theme}';

/** A PV the Trace hare mock never answers, so its metadata check stays pending. */
export const HOLD_PV = 'SR:HOLD';

const PV_PICKER_INPUT = '[data-testid=pv-picker-input]';
const PV_PICKER_ADD = '[data-testid=pv-picker-add]';

/** How long `hold-pv-check` waits for the Add button to disable; below the 3 s metadata timeout. */
const HOLD_DISABLED_TIMEOUT_MS = 2000;

const TAB_STRIP = '.tab-strip';
const DOCKED_TAB = `${TAB_STRIP} [role=tab][data-docked=true]`;
const UNDOCKED_TAB = `${TAB_STRIP} [role=tab][data-docked=false]`;
/** The dock root while it lists two or more docked keys (`data-docked` is a JSON array). */
const TWO_TILES = `[data-testid=workspace-dock][data-docked*='","']`;

/** The tile edge `hold-tab-drag` holds the drag at. */
const HOLD_EDGE = 'bottom';
/** How long `hold-tab-drag` repeats dragover before it gives up on the drop highlight. */
const HOLD_HIGHLIGHT_BUDGET_MS = 1000;

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function selectFirstNavRow(page) {
  await page.locator('.nav-tree__row').first().click();
  await page.locator('.nav-tree__row--selected').first().waitFor();
}

/**
 * Opens the write-confirmation dialog and stops there: it never confirms, so no PV is written.
 * The page must run against a hare backend that reports `PROBE:WRITE` writable.
 *
 * @param {PageLike} page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function openWriteDialog(page, ctx) {
  if (!new URL(page.url(), 'http://probe.invalid').pathname.endsWith('/embed/drafts/write-probe')) {
    const path = WRITE_PROBE_PAGE.replaceAll('{theme}', ctx.theme ?? 'light');
    await (ctx.goto ? ctx.goto(path) : page.goto(path));
  }
  const input = page.locator('.carbon-pv-input input').first();
  await input.fill('1');
  await input.press('Enter');
  await page.locator('[data-testid=canopy-write-dialog]').waitFor();
}

/**
 * @param {PageLike} _page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function hover(_page, ctx) {
  await ctx.locator.hover();
}

/**
 * @param {PageLike} _page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function focus(_page, ctx) {
  await ctx.locator.focus();
}

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function hoverHeaderAction(page) {
  await page.locator('.cds--header__action').first().hover();
  await page.locator('.cds--header__global .cds--popover-content').first().waitFor();
}

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openScreenTreeMenu(page) {
  await page.locator('.screen-tree [role=treeitem]').first().click({ button: 'right' });
  await page.locator('.cds--menu').first().waitFor();
}

/**
 * The Save-view button renders only on a tool tab.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openTraceTab(page) {
  await page.locator('.screen-tree [data-tool=trace]').first().click();
  await page.locator('.save-view__button').first().waitFor();
}

/**
 * Opens the context menu of the first saved view. The page needs one: the caller seeds it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openViewMenu(page) {
  await page
    .locator('.screen-tree [data-view-id] > .nav-tree__row')
    .first()
    .click({ button: 'right' });
  await page.locator('.cds--menu-item--danger').first().waitFor();
}

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openInsightOverflow(page) {
  await page.getByRole('button', { name: /^Data Insight/ }).click();
  const actions = page.locator('.insight-tool__actions').first();
  await actions.waitFor();
  await actions.locator('.cds--overflow-menu').first().click();
  await page.locator('.cds--overflow-menu-options').first().waitFor();
}

/**
 * Resolves once the picker's Add button is disabled.
 *
 * @param {PageLike} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} Whether it was disabled within the timeout.
 */
async function addDisabledWithin(page, timeoutMs) {
  const add = page.locator(PV_PICKER_ADD).first();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await add.isDisabled()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Submits a PV whose metadata check never completes, which holds the Add button disabled. The
 * hold ends after the picker's metadata timeout (3 s), so a row using this setup is checked at
 * once and re-checked by `postconditions['hold-pv-check']`.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function holdPvCheck(page) {
  const input = page.locator(PV_PICKER_INPUT).first();
  await input.fill(HOLD_PV);
  await input.press('Enter');
  if (!(await addDisabledWithin(page, HOLD_DISABLED_TIMEOUT_MS))) {
    throw new Error(`hold-pv-check: ${PV_PICKER_ADD} did not become disabled`);
  }
}

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function switchDensityView(page) {
  await page.locator(".correlation-plot__toolbar button:has-text('Density')").first().click();
  await page.locator('[data-testid=density-y-select]').first().waitFor();
}

/**
 * Leaves two tiles side by side, using clicks only: the Trace leaf of the tree opens a second tab
 * in the one tile, which sends the screen's tab out of the layout, and the strip's "Open in a new
 * tile" docks that tab again. The screen's tile is the focused one afterwards.
 *
 * It changes the stored dock arrangement, so a row using it cannot share a browser context with
 * rows that expect one tile.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function dockSecondTile(page) {
  await page.locator('.screen-tree [data-tool=trace]').first().click();
  const undocked = page.locator(UNDOCKED_TAB).first();
  await undocked.waitFor();
  await undocked.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in a new tile' }).click();
  await page.locator(TWO_TILES).first().waitFor();
  await page.locator('[data-testid=tile-bar-title]').first().waitFor();
}

/**
 * Starts the drag and holds it; runs in the page, on the strip tab that is dragged.
 *
 * @param {Element} source
 * @param {{ edge: string, budgetMs: number }} arg
 * @returns {Promise<string | null>} Why the drag is not held, or null when it is.
 */
async function holdTabDragInPage(source, { edge, budgetMs }) {
  const doc = source.ownerDocument;
  const view = /** @type {any} */ (doc.defaultView);
  const key = source.getAttribute('data-tab-key');
  // The tile to hold over: the first one that shows another panel.
  let content = null;
  for (const bar of doc.querySelectorAll('[data-testid="tile-bar"]')) {
    if (bar.getAttribute('data-panel-key') === key) continue;
    content = bar.closest('.dv-groupview')?.querySelector('.dv-content-container') ?? null;
    if (content) break;
  }
  if (!content) return 'no second tile to hold the drag over';
  const rect = content.getBoundingClientRect();
  const inset = 5;
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const point = {
    left: { x: rect.x + inset, y: midY },
    right: { x: rect.x + rect.width - inset, y: midY },
    top: { x: midX, y: rect.y + inset },
    bottom: { x: midX, y: rect.y + rect.height - inset },
  }[edge];

  const dataTransfer = new view.DataTransfer();
  const at = (/** @type {{ x: number, y: number }} */ p) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer,
    clientX: p.x,
    clientY: p.y,
  });
  const sleep = (/** @type {number} */ ms) => new Promise((r) => view.setTimeout(r, ms));
  const s = source.getBoundingClientRect();
  source.dispatchEvent(
    new view.DragEvent('dragstart', at({ x: s.x + s.width / 2, y: s.y + s.height / 2 }))
  );
  // The drag shield is a render away; hit-test only once it is up.
  const shieldDeadline = view.performance.now() + 1000;
  while (doc.querySelector('.canopy-dock-overlay')?.getAttribute('data-dragging') !== 'true') {
    if (view.performance.now() > shieldDeadline) return 'the drag shield never rose';
    await sleep(16);
  }
  const target = doc.elementFromPoint(point.x, point.y);
  if (!target) return `nothing at (${point.x}, ${point.y})`;
  view.__canopyDockDrag = { source, target, dataTransfer, point, edge };

  const painted = () => {
    for (const el of doc.querySelectorAll(`.dv-drop-target-anchor.dv-drop-target-${edge}`)) {
      const r = el.getBoundingClientRect();
      if (view.getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0) {
        return true;
      }
    }
    return false;
  };
  target.dispatchEvent(new view.DragEvent('dragenter', at(point)));
  const deadline = view.performance.now() + budgetMs;
  for (;;) {
    target.dispatchEvent(new view.DragEvent('dragover', at(point)));
    await sleep(50);
    if (painted()) return null;
    if (view.performance.now() > deadline) return `no ${edge} drop highlight was painted`;
  }
}

/**
 * Ends the held drag without dropping; runs in the page, on the tab strip.
 *
 * @param {Element} strip
 * @returns {Promise<string | null>} What was wrong with the held drag, or null.
 */
async function releaseTabDragInPage(strip) {
  const doc = strip.ownerDocument;
  const view = /** @type {any} */ (doc.defaultView);
  const held = view.__canopyDockDrag;
  if (!held) return 'no drag is held';
  delete view.__canopyDockDrag;

  let painted = false;
  for (const el of doc.querySelectorAll(`.dv-drop-target-anchor.dv-drop-target-${held.edge}`)) {
    const r = el.getBoundingClientRect();
    if (view.getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0) {
      painted = true;
    }
  }

  const sleep = (/** @type {number} */ ms) => new Promise((r) => view.setTimeout(r, ms));
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: held.dataTransfer,
    clientX: held.point.x,
    clientY: held.point.y,
  };
  held.target.dispatchEvent(new view.DragEvent('dragleave', init));
  await sleep(80);
  (held.source.isConnected ? held.source : doc).dispatchEvent(new view.DragEvent('dragend', init));

  const deadline = view.performance.now() + 1000;
  while (doc.querySelector('.canopy-dock-overlay')?.getAttribute('data-dragging') === 'true') {
    if (view.performance.now() > deadline) return 'the drag shield stayed up after the release';
    await sleep(16);
  }
  return painted ? null : 'the drop highlight was gone; the row was read too late';
}

/**
 * Drags the first docked strip tab over an edge of the other tile and holds it there, so the
 * drop highlight stays painted. Starts from the two tiles of `dock-second-tile`.
 *
 * Playwright's mouse never raises HTML5 drag-and-drop, so the gesture is synthetic and runs in
 * the page, the same sequence as the viewer's e2e helper (`holdDrag` of dockHelpers.ts):
 * `dragstart` on the tab with one shared DataTransfer, then, once the overlay's drag shield is
 * up, `dragenter` and a `dragover` every 50 ms on whatever `elementFromPoint` returns 5 px inside
 * the tile's edge, until the highlight is painted. `postconditions['hold-tab-drag']` releases it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function holdTabDrag(page) {
  await page.locator(TWO_TILES).first().waitFor();
  const failure = await page
    .locator(DOCKED_TAB)
    .first()
    .evaluate(holdTabDragInPage, { edge: HOLD_EDGE, budgetMs: HOLD_HIGHLIGHT_BUDGET_MS });
  if (failure !== null) throw new Error(`hold-tab-drag: ${failure}`);
}

/**
 * Conditions that must still hold when a row's expectations have been read, by setup name, and
 * the release of a state a setup holds. The probe runner runs them as the last step of a row.
 *
 * @type {Record<string, (page: PageLike) => Promise<void>>}
 */
export const postconditions = {
  // A check that outlived the metadata timeout re-enables the button; the row then read an
  // enabled button and its colours mean nothing.
  'hold-pv-check': async (page) => {
    if (!(await page.locator(PV_PICKER_ADD).first().isDisabled())) {
      throw new Error(
        `hold-pv-check: ${PV_PICKER_ADD} is no longer disabled; the row was read too late`
      );
    }
  },
  // The held drag is released without a drop (dragleave, then dragend on the tab), so the two
  // tiles stay as they were. A highlight that was gone by now means the row read nothing.
  'hold-tab-drag': async (page) => {
    const failure = await page.locator(TAB_STRIP).first().evaluate(releaseTabDragInPage);
    if (failure !== null) throw new Error(`hold-tab-drag: ${failure}`);
  },
};

export {
  selectFirstNavRow as 'select-first-nav-row',
  openWriteDialog as 'open-write-dialog',
  hover as 'hover',
  focus as 'focus',
  hoverHeaderAction as 'hover-header-action',
  openScreenTreeMenu as 'open-screen-tree-menu',
  openInsightOverflow as 'open-insight-overflow',
  holdPvCheck as 'hold-pv-check',
  switchDensityView as 'switch-density-view',
  openTraceTab as 'open-trace-tab',
  openViewMenu as 'open-view-menu',
  dockSecondTile as 'dock-second-tile',
  holdTabDrag as 'hold-tab-drag',
};
