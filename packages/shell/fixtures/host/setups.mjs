// The page setups the probe rows of hostProbes.json name: what has to happen on a page before a
// row's element exists or is in the state the row probes. Every setup lives here once, so the
// viewer specs, the Trace specs and the stack probe drive a page the same way.
//
// Plain ESM, duck-typed on the part of Playwright's API that a Page and a Frame share (`locator`,
// `getByRole`, `url`, `goto`), so this package needs no Playwright dependency and a setup also
// runs inside an iframe. The exports are string-named after the values of a row's `setup` array.

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
 * Conditions that must still hold when a row's expectations have been read, by setup name. The
 * probe runner runs them as the last step of a row.
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
};
