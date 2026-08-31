// The Today group must list the risk page between the builder and the draw.
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
  await expect(page.getByRole('heading', { name: /what today can do to you/i })).toBeVisible({ timeout: 15000 });
});
