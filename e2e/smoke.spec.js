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
  // The headline is now a claim about the TOOL, not about the ledger, so it
  // is fixed copy and cannot come untrue on a bad week. The honesty gate did
  // not disappear, it moved to the sub-line, where the market comparison
  // lives - and that is asserted below on the gate's behaviour rather than on
  // which side of it this season happens to be.
  await expect(page.locator('.main-title')).toHaveText(/Know What to Stake/, { timeout: 15000 });
  // The market claim appears ONLY when the ledger supports it AND is known.
  // Whichever way the season is running, the sub-line must never be mid-
  // sentence or assert a comparison with no numbers in it.
  const sub = await page.locator('.sub-title').innerText();
  expect(sub).toMatch(/calls every ATP and WTA match/i);
  if (/split from the betting favorite/i.test(sub)) {
    expect(sub).toMatch(/returned [+-]\d+% while the same money on theirs returned [+-]\d+%/i);
  }
  // The proof rail loads from track_record.json - a number, not a skeleton.
  // Asserted on the rail itself rather than any one caption: the captions
  // change with the season (off-season copy vs a live board), and this test
  // is about the data arriving, not about which phrase is on screen.
  await expect(page.locator('.home-stat-val').first()).toHaveText(/\d/, { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('track record: hero, filters, event dropdown, match log', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/track-record');
  await expect(page.getByRole('heading', { name: /every call, graded/i })).toBeVisible();
  await expect(page.locator('.track-hero-value')).toHaveText(/%/, { timeout: 15000 });

  // Surface filter reaches the surface-scoped copy. Which element carries
  // that copy depends on whether the forward test has earned the hero slot
  // yet, so assert the label lands somewhere in the stats block rather than
  // pinning one selector that moves with the season.
  await page.getByRole('button', { name: 'Grass', exact: true }).click();
  await expect(
    page.locator('.track-hero-sub, .track-benchmark-text').filter({ hasText: /Grass/i }).first()
  ).toBeVisible({ timeout: 5000 });

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
  await page.getByRole('button', { name: 'The Receipts' }).click();
  await page.locator('.nav-pillar-menu').getByRole('link', { name: /the ledger/i }).click();
  await expect(page.getByRole('heading', { name: /every call, graded/i })).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('parlay builder: the plan prices today\'s card and dropping a leg re-prices it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/parlay');
  // Retitled when the page became a staking plan you follow rather than a
  // parlay you assemble (changelog 4.2.3).
  await expect(page.getByRole('heading', { name: /today's staking plan/i })).toBeVisible();

  // Either there are calls today (the plan renders) or the honest empty state.
  // There is no separate selection list any more: every call arrives already
  // in the plan, which is the single table for both picking and pricing.
  //
  // WAIT for one of the two before branching. Counting straight after goto()
  // raced the predictions fetch: on a slow load neither had rendered yet, the
  // test took the empty branch and then failed looking for an empty state
  // that was also still on its way. That is what made this flaky.
  await page.waitForSelector('.stake-plan, .parlay-empty', { timeout: 20000 });
  const plan = page.locator('.stake-plan');
  if (await plan.count() === 0) {
    await expect(page.locator('.parlay-empty')).toBeVisible();
    expect(errors).toEqual([]);
    return;
  }

  // Priced on arrival, with no clicks: budget mode is the default. The
  // headline is the plan's chance of finishing ahead. This used to assert on
  // .stake-value-pct, the combined "chance all N land" accumulator, which is
  // gone: across a full card it priced a bet nobody could place.
  const headline = page.locator('.stake-best-v').first();
  await expect(headline).toHaveText(/%/, { timeout: 15000 });

  const rows = page.locator('.stake-row:not(.stake-row-head):not(.stake-row-parlay)');
  const startCount = await rows.count();
  expect(startCount).toBeGreaterThan(0);

  // Dropping a leg re-prices the plan. The direction of the chance of
  // finishing ahead is deliberately NOT asserted: unlike the old accumulator,
  // removing a match can move it either way depending on that match's price,
  // so pinning a direction would be pinning a coincidence. What must hold is
  // that the card shrinks and the plan re-states itself over what is left.
  if (startCount > 1) {
    // The subhead names the size of the card ("from today's N matches"), which
    // moves whatever is dropped. The BACKED count is not safe to assert on:
    // unpriced matches are never staked, so dropping one changes the card
    // without changing the plan.
    const subBefore = await page.locator('.stake-best-sub').first().textContent();
    await page.locator('.stake-drop button').first().click();
    await expect(rows).toHaveCount(startCount - 1);
    await expect(headline).toHaveText(/%/);
    await expect(page.locator('.stake-best-sub').first()).not.toHaveText(subBefore);
  }
  expect(errors).toEqual([]);
});

test('edge board: disagreement hero and graded split rows', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/edge');
  // The Edge leads with what disagreements RETURN, not who guesses better
  // (changelog 4.2.4).
  await expect(page.getByRole('heading', { name: /what our disagreements are worth/i })).toBeVisible();
  await expect(page.locator('.edge-hero-val').first()).toHaveText(/%/, { timeout: 15000 });
  await expect(page.locator('.edge-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('compare: hub renders and a deep link compares three players', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: /compare any players/i })).toBeVisible();
  await page.goto('/compare/atp/jannik-sinner-vs-alexander-zverev-vs-carlos-alcaraz');
  await expect(page.getByRole('heading', { name: /sinner vs zverev vs alcaraz/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.compare-tr').first()).toBeVisible();
  await expect(page.locator('.compare-pair')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('season rewind: headline, bold calls, engines', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/season');
  await expect(page.getByRole('heading', { name: /season, graded/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.rewind-hero-val').first()).toHaveText(/%/);
  await expect(page.locator('.rewind-call').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('bracket challenge: renders the whole draw, whatever size it is', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/challenge');
  await expect(page.getByRole('heading', { name: /beat the model's bracket/i })).toBeVisible();
  // Asserting on "one of these is visible" is what let a real regression
  // through: the page used to require a field of exactly 16, so when the
  // projection grew to a full 128 draw it silently fell back to the empty
  // state and this test still passed. Now the draw on file decides the
  // rounds, so when there IS a field the bracket must actually render.
  const rounds = page.locator('.challenge-round');
  const empty = page.locator('.challenge-empty');
  await expect(rounds.first().or(empty.first())).toBeVisible({ timeout: 15000 });
  if (await rounds.count() > 0) {
    // Rounds must halve down to a single champion pick, so the count is
    // log2(field) and the last round has exactly one match.
    const n = await rounds.count();
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(rounds.last().locator('.challenge-match')).toHaveCount(1);
    // First round must be the biggest; a fixed table would flatten this.
    const first = await rounds.first().locator('.challenge-match').count();
    expect(first).toBe(2 ** (n - 1));
  }
  expect(errors).toEqual([]);
});

test('form chart: elo table with movers and tour toggle', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/form');
  await expect(page.getByRole('heading', { name: /actually hot right now/i })).toBeVisible();
  await expect(page.locator('.form-tr:not(.head)').first()).toBeVisible({ timeout: 15000 });
  const firstName = await page.locator('.form-player').first().textContent();
  await page.getByRole('button', { name: 'WTA', exact: true }).click();
  await expect(page.locator('.form-player').first()).not.toHaveText(firstName, { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('event page: graded record, engines, results', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/event/wimbledon');
  await expect(page.getByRole('heading', { name: /wimbledon, graded/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.event-hero-val').first()).toHaveText(/%/);
  await expect(page.locator('.event-row').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('today page renders calls or the honest empty state', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: /locked before play/i })).toBeVisible();
  await expect(page.locator('.today-list, .today-empty').first()).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('dream brackets: a full draw renders a quarter at a time', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/dream-brackets');

  // Small draws must be untouched by segmentation: no tabs, and the columns
  // run straight from the starting round to the champion.
  await expect(page.locator('.bracket-col h6').first()).toBeVisible({ timeout: 20000 });
  expect(await page.locator('.bracket-view-tab').count()).toBe(0);

  // Switch to the full draw. Found by its options rather than by position, so
  // reordering the stage list cannot silently retarget this (the same
  // index-based assumption already moved the page's default once).
  const selects = page.locator('select.dark-select');
  let stage = null;
  for (let i = 0; i < await selects.count(); i++) {
    const values = await selects.nth(i).locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (values.includes('r64')) { stage = selects.nth(i); break; }
  }
  expect(stage).not.toBeNull();
  await stage.selectOption('r64');

  // Four quarters and a finals view, not one 4,200px column.
  await expect(page.locator('.bracket-view-tab')).toHaveCount(5);
  // A quarter is a 16-slot bracket: 8 opening matches, five columns ending on
  // the semi-finalist rather than a champion (only one view may crown anyone).
  await expect(page.locator('.bracket-col').first().locator('.bracket-match')).toHaveCount(8);
  await expect(page.locator('.bracket-col h6').last()).toHaveText(/INTO THE SEMIS/i);

  // The closing view is the last EIGHT: four quarter-final matches resolving
  // into the semis, the final and the champion, so it stands as a bracket on
  // its own rather than starting from four names with no visible source.
  await page.locator('.bracket-view-tab').last().click();
  await expect(page.locator('.bracket-col h6').first()).toHaveText(/QUARTER-FINALS/i);
  await expect(page.locator('.bracket-col h6').last()).toHaveText(/CHAMPION/i);
  await expect(page.locator('.bracket-col h6')).toHaveCount(4);
  await expect(page.locator('.bracket-col').first().locator('.bracket-match')).toHaveCount(4);
  expect(errors).toEqual([]);
});
