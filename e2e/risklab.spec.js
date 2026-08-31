// The risk sizing panel, against the real production bundle.
const { test, expect } = require('@playwright/test');

test('risk lab: renders, reacts to stakes, and switches views', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');

  // Settle first: branching on a count() taken straight after goto() races the
  // predictions fetch and lands in the wrong branch on a slow load.
  await page.waitForSelector('.risk-lab, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  const lab = page.locator('.risk-lab');
  // Off-season the builder has no legs, so the panel correctly does not exist.
  if (await lab.count() === 0) {
    await expect(page.locator('.parlay-empty, .parlay-slip-empty').first()).toBeVisible();
    expect(errors).toEqual([]);
    return;
  }

  await expect(lab).toBeVisible();
  await expect(page.locator('.risk-tabs button')).toHaveCount(3);

  // The whole day's card is here, with a parlay assembled from it - this page
  // owns its own selection rather than inheriting the builder's.
  const rows = page.locator('.risk-leg');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  await expect(page.locator('.risk-legs-head')).toBeVisible();

  // Dropping a match takes it off the card entirely.
  if (rowCount > 1) {
    await page.locator('.risk-leg-drop button').first().click();
    await expect(rows).toHaveCount(rowCount - 1);
  }

  // Exposure responds to the stake box: this is the whole premise of the tab.
  const before = await page.locator('.risk-exposure-cap').innerText();
  const stake = page.locator('.risk-inputs input[type="number"]').nth(1);
  await stake.fill('40');
  await expect(page.locator('.risk-exposure-cap')).not.toHaveText(before);

  // "This slip": percentile metrics and the loss-exceedance ladder.
  await expect(page.locator('.risk-chart').first()).toBeVisible();
  await expect(page.locator('.risk-ladder li').first()).toBeVisible();

  // Bigger losses are never more likely than smaller ones - the ladder must
  // read as a non-increasing column, which is the one thing a reader will
  // check by eye.
  const probs = await page.locator('.risk-ladder li strong').allInnerTexts();
  const nums = probs.map((t) => (t.startsWith('<') ? 0.05 : parseFloat(t)));
  for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeLessThanOrEqual(nums[i - 1] + 1e-9);

  // "Repeated": the fan chart and a ruin figure.
  await page.getByRole('tab', { name: 'Repeated' }).click();
  await expect(page.locator('.risk-chart')).toBeVisible();
  await expect(page.getByText('chance of going broke')).toBeVisible();

  // "My limits": the Kelly gauge and a verdict.
  await page.getByRole('tab', { name: 'My limits' }).click();
  await expect(page.locator('.risk-gauge, .risk-verdict').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('risk lab: a bankroll too small for the stake reads as over-sized', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  await page.waitForSelector('.risk-lab, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  if (await page.locator('.risk-lab').count() === 0) { expect(errors).toEqual([]); return; }

  // Tiny bankroll, large flat stake: must land in an over-Kelly band, which is
  // the warning the panel exists to give.
  await page.locator('.risk-inputs input[type="number"]').nth(0).fill('50');
  await page.locator('.risk-inputs input[type="number"]').nth(1).fill('40');
  await page.getByRole('tab', { name: 'My limits' }).click();
  await expect(page.locator('.risk-verdict.aggressive, .risk-verdict.ruinous, .risk-verdict.none').first())
    .toBeVisible({ timeout: 10000 });
  expect(errors).toEqual([]);
});
