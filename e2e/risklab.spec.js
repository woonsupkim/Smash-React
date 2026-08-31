// The risk lab, now the second half of the parlay builder rather than its own
// page, against the real production bundle.
const { test, expect } = require('@playwright/test');

// The card takes a moment to arrive; branching on a count() straight after
// goto() races the predictions fetch and lands in the wrong branch.
async function openCard(page) {
  await page.waitForSelector('.stake-plan, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  return (await page.locator('.risk-lab').count()) > 0;
}

test('risk lab: reads the plan on the page, and switches views', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/parlay');
  if (!(await openCard(page))) {
    await expect(page.locator('.parlay-empty, .parlay-slip-empty').first()).toBeVisible();
    expect(errors).toEqual([]);
    return;
  }

  const lab = page.locator('.risk-lab');
  await expect(lab).toBeVisible();
  await expect(page.locator('.risk-tabs button')).toHaveCount(3);

  // One card on the page, owned by the staking plan, and one number for the
  // money you are playing with. The lab must not have grown a second copy of
  // the card, a second stake box, a second plan menu, or a bankroll input
  // alongside the budget: every one of those was a second place to say the
  // same thing, which is the whole reason the two pages became one.
  await expect(page.locator('.risk-legs')).toHaveCount(0);
  await expect(page.locator('.risk-plan-chip')).toHaveCount(0);
  await expect(page.locator('.risk-inputs')).toHaveCount(0);
  await expect(page.locator('.stake-table')).toHaveCount(1);

  // The lab sits where the outcome histogram used to, inside the plan. Two
  // drawings of one distribution is one too many.
  await expect(page.locator('.stake-dist')).toHaveCount(0);
  await expect(page.locator('.stake-out .risk-lab')).toHaveCount(1);

  // The lab describes the plan above it rather than stakes of its own.
  await expect(page.locator('.risk-sub')).toContainText('Change the plan above');

  // "This slip": the combined outcome curve and both ladders.
  await expect(page.locator('.risk-chart.wide')).toHaveCount(1);
  await expect(page.locator('.risk-two-up .risk-ladder')).toHaveCount(2);
  // Scoped: the staking plan above says "expected profit" too, which is the
  // point - both surfaces describe one allocation - but an unscoped query
  // matches all of them.
  await expect(lab.getByText('expected profit', { exact: false }).first()).toBeVisible();
  await expect(lab.getByText('if everything lands', { exact: false })).toBeVisible();

  // Bigger losses are never more likely than smaller ones, and neither are
  // bigger wins - each ladder must read as a non-increasing column, which is
  // the one thing a reader will check by eye.
  for (const i of [0, 1]) {
    const texts = await page.locator('.risk-two-up .risk-ladder-col').nth(i)
      .locator('.risk-ladder li strong').allInnerTexts();
    const nums = texts.map((t) => (t.startsWith('<') ? 0.05 : parseFloat(t)));
    for (let j = 1; j < nums.length; j++) expect(nums[j]).toBeLessThanOrEqual(nums[j - 1] + 1e-9);
  }

  // "Repeated": the fan chart and a ruin figure.
  await page.getByRole('tab', { name: 'If I did this all season' }).click();
  await expect(page.locator('.risk-chart').first()).toBeVisible();
  await expect(lab.getByText('chance of going broke')).toBeVisible();
  await expect(lab.getByText('chance you finish up', { exact: false })).toBeVisible();

  // "My limits": the Kelly gauge and a verdict.
  await page.getByRole('tab', { name: 'Am I betting too big?' }).click();
  await expect(page.locator('.risk-gauge, .risk-verdict').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('risk lab: changing the plan moves the risk numbers', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/parlay');
  if (!(await openCard(page))) { expect(errors).toEqual([]); return; }

  // This is the whole premise of merging the two: one allocation, read by both
  // surfaces. If the lab can disagree with the table above it, the merge has
  // bought nothing and cost a page.
  const before = await page.locator('.risk-sub').innerText();
  const cards = page.locator('.stake-best-opt');
  if (await cards.count() > 1) {
    await cards.nth(1).click();
    await expect(page.locator('.risk-sub')).not.toHaveText(before);
  }

  // Dropping a match re-prices the plan, so the lab has to follow it down.
  const drops = page.locator('.stake-drop button');
  if (await drops.count() > 1) {
    const mid = await page.locator('.risk-sub').innerText();
    await drops.first().click();
    await expect(page.locator('.risk-sub')).not.toHaveText(mid);
  }

  expect(errors).toEqual([]);
});

test('risk lab: staking the whole budget reads as riskier than the plan', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/parlay');
  if (!(await openCard(page))) { expect(errors).toEqual([]); return; }

  // Kelly's bands, coldest first. The budget is now the bankroll, so a
  // recommendation sized to it cannot be reckless by construction - but
  // spreading the WHOLE budget across the card can be, and the gauge has to
  // still say so. That gap is the only reason the tab exists.
  const BANDS = ['conservative', 'full', 'aggressive', 'ruinous'];
  const band = async () => {
    await page.getByRole('tab', { name: 'Am I betting too big?' }).click();
    const cls = await page.locator('.risk-verdict').first().getAttribute('class');
    await page.getByRole('tab', { name: 'Today' }).click();
    return BANDS.findIndex((b) => cls.includes(b));
  };

  const rec = await band();
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByRole('button', { name: 'Flat across the card' }).click();
  const flat = await band();
  expect(rec).toBeGreaterThanOrEqual(0);
  expect(flat).toBeGreaterThan(rec);

  expect(errors).toEqual([]);
});

test('/risk still resolves, and lands on the risk lab', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The digest, the home page and the site footer all link here by name. The
  // route outlived the page, so the link has to keep working.
  await page.goto('/risk');
  await page.waitForSelector('.stake-plan, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: /today.s staking plan/i })).toBeVisible();
  if (await page.locator('.risk-lab').count() > 0) {
    await expect(page.locator('#risk')).toBeInViewport({ timeout: 10000 });
  }
  expect(errors).toEqual([]);
});
