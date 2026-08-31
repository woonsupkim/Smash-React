// The Today group lists the Risk Lab where the parlay builder used to sit.
// They are one page now: the staking plan, and the exposure read that follows
// from it, under the name that describes what the page is actually for.
const { test, expect } = require('@playwright/test');

test('Risk Lab sits in the Today nav, once, after today\'s calls', async ({ page }) => {
  await page.goto('/');
  // Scoped to the desktop nav: "Today" also names a mobile tab-bar item, and
  // an unscoped role query matches both.
  await page.locator('.nav-pillar-btn', { hasText: 'Today' }).first().click();
  const items = await page.locator('.nav-pillar-menu').first().locator('a').allInnerTexts();
  const names = items.map((t) => t.trim());

  // Exactly one entry. It was listed twice while the builder and the lab were
  // separate pages, and a nav offering two routes to one page asks the reader
  // to work out a difference that no longer exists.
  expect(names.filter((t) => t === 'Risk Lab')).toHaveLength(1);
  expect(names).not.toContain('The Parlay Builder');
  const i = names.findIndex((t) => t === 'Risk Lab');
  expect(names[i - 1]).toMatch(/Today/);
  expect(names[i + 1]).toMatch(/The Draw/);

  await page.locator('.nav-pillar-menu').getByRole('link', { name: 'Risk Lab' }).click();
  await expect(page.getByRole('heading', { name: /today.s staking plan/i })).toBeVisible({ timeout: 15000 });
});
