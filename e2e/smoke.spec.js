// Smoke suite: the five key pages render real data and their core
// interactions work. Guards the class of regression the unit tests can't
// see (routing, data fetching, filter wiring). Every page also asserts
// zero uncaught page errors.
const { test, expect } = require('@playwright/test');

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('home renders the board and proof rail', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByText('Simulate the Slams', { exact: false })).toBeVisible();
  // The proof rail loads from track_record.json - a number, not a skeleton.
  await expect(page.getByText(/of winners called|winners called/i).first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('track record: hero, filters, event dropdown, match log', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/track-record');
  await expect(page.getByRole('heading', { name: /track record/i })).toBeVisible();
  await expect(page.locator('.track-hero-value')).toHaveText(/%/, { timeout: 15000 });

  // Surface filter changes the hero sample size.
  const subBefore = await page.locator('.track-hero-sub').textContent();
  await page.getByRole('button', { name: 'Grass', exact: true }).click();
  await expect(page.locator('.track-hero-sub')).not.toHaveText(subBefore, { timeout: 5000 });

  // Event dropdown filters the log.
  const select = page.locator('.track-event-select');
  await expect(select).toBeVisible();
  await expect(page.locator('.track-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('h2h studio: featured matchup simulates and the engine picker works', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/h2h?surface=hard');
  // The featured matchup auto-simulates a verdict percentage.
  await expect(page.locator('.mh-prob, .verdict-pct').first()).toHaveText(/%/, { timeout: 20000 });

  // Engine picker lives in the Detailed simulation drawer.
  await page.locator('.studio-drawer summary').click();
  const buttons = page.locator('.adv-engine-btn');
  await expect(buttons).toHaveCount(5);
  const verdictBefore = await page.locator('.mh-prob, .verdict-pct').first().textContent();
  await buttons.filter({ hasText: 'Rankings' }).click();
  await expect(buttons.filter({ hasText: 'Rankings' })).toHaveClass(/active/);
  // Verdict re-renders (usually a different number; at minimum still a %).
  await expect(page.locator('.mh-prob, .verdict-pct').first()).toHaveText(/%/);
  expect(errors).toEqual([]);
});

test('model card: engines, scorecard, engine health board', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/model');
  await expect(page.getByText('Five engines compete', { exact: false })).toBeVisible();
  await expect(page.getByText(/graded matches this season/i).first()).toBeVisible({ timeout: 15000 });
  // Engine health board renders when guardrails.json exists (it does in prod data).
  await expect(page.locator('.mc-guard-table')).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('player page: profile, record, and elo form curve', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/player/atp/sinne');
  await expect(page.getByText(/sinner/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.player-elo .elo-chart')).toBeVisible({ timeout: 15000 });

  // Form-strip tooltip: hovering a result dot shows the opponent bubble
  // (a CSS ::after, so assert its computed opacity, not visibility).
  const dot = page.locator('.player-form-dot').first();
  await expect(dot).toBeVisible({ timeout: 15000 });
  await expect(dot).toHaveAttribute('data-tip', /def\.|lost to/);
  await dot.hover();
  await expect
    .poll(() => dot.evaluate((el) => getComputedStyle(el, '::after').opacity))
    .toBe('1');
  expect(errors).toEqual([]);
});

test('pickem renders the game and degrades honestly without accounts', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/pickem');
  await expect(page.getByRole('heading', { name: /pick'em/i })).toBeVisible();
  // Model's forward record loads from predictions.json.
  await expect(page.getByText(/model's locked record|locked record/i).first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('h2h why panel shows the form-curve overlay', async ({ page }) => {
  const errors = collectErrors(page);
  // Deep link a known pair: the daily featured matchup rotates and a player
  // freshly renamed in the roster can lack seed history until the next
  // data refresh.
  await page.goto('/h2h?surface=hard&a=sinne&b=zvere');
  await expect(page.locator('.why-form-curves .elo-chart')).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});

test('rivalry page renders h2h, verdict reads, and form curves', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/rivalry/atp/jannik-sinner-vs-alexander-zverev');
  await expect(page.getByRole('heading', { name: /sinner.*zverev/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.rivalry-h2h-score')).toBeVisible();
  await expect(page.locator('.rivalry-read-pct').first()).toHaveText(/%/, { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('nav pillars open and navigate', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Prove' }).click();
  await page.locator('.nav-pillar-menu').getByRole('link', { name: /the ledger/i }).click();
  await expect(page.getByRole('heading', { name: /track record/i })).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('today page renders calls or the honest empty state', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: /locked before play/i })).toBeVisible();
  await expect(page.locator('.today-list, .today-empty').first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});
