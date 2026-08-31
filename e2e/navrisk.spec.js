// The Today group must still list the Risk Lab between the builder and the
// draw, even though it is now a section of the builder rather than a page.
const { test, expect } = require('@playwright/test');

test('Risk Lab sits in the Today nav, after the builder', async ({ page }) => {
  await page.goto('/');
  // Scoped to the desktop nav: "Today" also names a mobile tab-bar item, and
  // an unscoped role query matches both.
  await page.locator('.nav-pillar-btn', { hasText: 'Today' }).first().click();
  const items = await page.locator('.nav-pillar-menu').first().locator('a').allInnerTexts();
  const names = items.map((t) => t.trim());
  expect(names).toContain('Risk Lab');
  const i = names.findIndex((t) => t === 'Risk Lab');
  expect(names[i - 1]).toBe('The Parlay Builder');
  expect(names[i + 1]).toMatch(/The Draw/);

  await page.locator('.nav-pillar-menu').getByRole('link', { name: 'Risk Lab' }).click();
  // It lands on the builder now, scrolled to the lab: same destination, one
  // page instead of two.
  await expect(page.getByRole('heading', { name: /today.s staking plan/i })).toBeVisible({ timeout: 15000 });
  await page.waitForSelector('.stake-plan, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  if (await page.locator('.risk-lab').count() > 0) {
    await expect(page.locator('#risk')).toBeInViewport({ timeout: 10000 });
  }
});
