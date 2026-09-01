// The Risk Lab: today's card, the staking plan, and what that plan does to
// the budget behind it. One page, against the real production bundle.
const { test, expect } = require('@playwright/test');

// The card takes a moment to arrive; branching on a count() straight after
// goto() races the predictions fetch and lands in the wrong branch.
async function openCard(page) {
  await page.waitForSelector('.stake-plan, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  return (await page.locator('.risk-lab').count()) > 0;
}

// Three honest states this page can be in, and only the first has a lab to
// test: a live card with something worth staking; a live card where every
// remaining price is against us, which happens late in the day once the good
// matches have started; and no card at all. The suite used to assume an empty
// card was the only alternative and failed on the middle one.
async function skipUnlessPriced(page, errors) {
  if (await openCard(page)) return false;
  const quiet = page.locator('.parlay-empty, .parlay-slip-empty, .stake-noplan, .stake-note.muted');
  await expect(quiet.first()).toBeVisible();
  expect(errors).toEqual([]);
  return true;
}

test('risk lab: reads the plan on the page, and switches views', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

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
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

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
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

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

test('/parlay still resolves, for every link already published', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // The page was the parlay builder for its whole life. The sitemap, every
  // share asset already posted and every digest already sent point at that
  // URL, and none of them can be edited after the fact.
  await page.goto('/parlay');
  await page.waitForSelector('.stake-plan, .parlay-empty, .parlay-slip-empty', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: /today.s staking plan/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the table holds your picks, the bench holds the rest, and together they are the card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

  const picks = page.locator('.stake-row:not(.stake-row-head):not(.stake-row-parlay):not(.stake-row-none)');
  const bench = page.locator('.card-rail-item');
  const nPicks = await picks.count();
  const nBench = await bench.count();

  // The landing state is the recommendation's own choices, so the page is
  // useful before anyone touches it. Nothing else is in the table.
  expect(nPicks).toBeGreaterThan(0);
  const card = nPicks + nBench;

  // In Recommended the plan owns the selection, so the bench is a list to
  // read rather than one to act on: a control that edits a choice the next
  // recommendation is about to overwrite is a trap.
  if (nBench > 0) {
    await expect(bench.first()).toHaveClass(/locked/);
    await expect(bench.first().locator('input[type="checkbox"]')).toBeDisabled();
  }

  // Ticking a bench item in Custom moves it across. Both surfaces have to
  // move, or one of them is lying about what is in the slip.
  await page.getByRole('tab', { name: 'Custom' }).click();
  if (nBench > 0) {
    await expect(bench.first()).not.toHaveClass(/locked/);
    await bench.first().locator('input[type="checkbox"]').click();
    await expect(picks).toHaveCount(nPicks + 1);
    await expect(bench).toHaveCount(nBench - 1);

    // And the x sends it back rather than deleting it from the day.
    await page.locator('.stake-drop button').first().click();
    await expect(picks).toHaveCount(nPicks);
    await expect(bench).toHaveCount(nBench);
  }

  // Nothing is lost between the two: picks plus bench is always the card.
  expect((await picks.count()) + (await bench.count())).toBe(card);

  // Ordering applies to the picks and moves nothing else. Bigger first.
  await page.getByRole('button', { name: 'Our %', exact: true }).click();
  const probs = (await picks.locator('.stake-pick em').allInnerTexts())
    .map((t) => parseFloat((t.match(/([\d.]+)%/) || [])[1]));
  for (let i = 1; i < probs.length; i++) expect(probs[i]).toBeLessThanOrEqual(probs[i - 1] + 1e-9);

  // Every row says when it starts, on both surfaces.
  for (const sel of [picks.locator('.stake-pick em'), bench.locator('.card-rail-meta')]) {
    for (const t of await sel.allInnerTexts()) expect(t).toMatch(/(\d{1,2}:\d{2}\s?(AM|PM)|time TBD)/);
  }

  expect(errors).toEqual([]);
});

test('the tour filter scopes the card, and the plan with it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

  const picks = page.locator('.stake-row:not(.stake-row-head):not(.stake-row-parlay):not(.stake-row-none)');
  const bench = page.locator('.card-rail-item');
  const total = (await picks.count()) + (await bench.count());
  // Count first. Filtering to a tour can legitimately empty the picks, and
  // then the lab does not render at all - innerText() on a missing element
  // waits out the full timeout rather than failing fast, which read as the
  // click having hung.
  const exposure = async () => {
    const el = page.locator('.risk-exposure-cap');
    return (await el.count()) ? el.innerText() : '';
  };
  const before = await exposure();

  // Tour is the one control that re-prices: picking a tour prices a plan on
  // that tour rather than dimming half a plan built on both. The two tours
  // account for the whole card between them. A tour holding none of your
  // picks correctly prices nothing, so the exposure can be blank there.
  let partition = 0;
  const perTour = [];
  for (const t of [/^ATP/, /^WTA/]) {
    await page.locator('.card-rail-filters').getByRole('button', { name: t }).click();
    partition += (await picks.count()) + (await bench.count());
    perTour.push(await exposure());
  }
  expect(partition).toBe(total);
  if (total > 1) expect(perTour.some((x) => x !== before)).toBe(true);

  await page.locator('.card-rail-filters').getByRole('button', { name: 'Both' }).click();
  expect((await picks.count()) + (await bench.count())).toBe(total);

  expect(errors).toEqual([]);
});

test('the recommended plan finishes up on a typical day, and never buries the budget', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

  // The headline promise of the objective. Read off the lab, which prices
  // exactly what the plan above put on the table.
  const typical = await page.locator('.risk-metric').first().innerText();
  const dollars = parseFloat(typical.replace(/[^0-9.\-]/g, ''));
  expect(typical).not.toMatch(/^-/);
  expect(dollars).toBeGreaterThan(0);

  // It is a plan, not a punt: the whole budget never goes on the table, and a
  // bad day stays inside its ceiling.
  const exposure = await page.locator('.risk-exposure-cap').innerText();
  const pct = parseFloat((exposure.match(/([\d.]+)% of your/) || [])[1]);
  expect(pct).toBeLessThan(100);
  const bad = await page.locator('.risk-metric').nth(1).innerText();
  expect(Math.abs(parseFloat(bad.replace(/[^0-9.\-]/g, '')))).toBeLessThanOrEqual(15.5);

  expect(errors).toEqual([]);
});

test('custom mode prices the matches we would not call, and the plan still will not', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;
  // The recommendation never funds a match we declined to call, so none is in
  // the picks on arrival, and the bench only accepts picks in Custom. Switch
  // first, bring one across, then step back to Recommended to check what it
  // says about a pass it did not choose.
  const benchPass = page.locator('.card-rail-item.pass').first();
  if (await benchPass.count() === 0) { expect(errors).toEqual([]); return; }
  await page.getByRole('tab', { name: 'Custom' }).click();
  await benchPass.locator('input[type="checkbox"]').click();

  const pass = page.locator('.stake-row.pass').first();
  await expect(pass).toBeVisible();

  await page.getByRole('tab', { name: 'Recommended' }).click();

  // Recommended: no edge figure, nothing to stake. Our probability on a coin
  // flip is the number we have just said we do not trust.
  await expect(pass.locator('.stake-pass-tag')).toBeVisible();
  await expect(pass.locator('.stake-single input')).toHaveCount(0);

  // Custom: the slip is the user's, so it prices. The edge appears with the
  // caveat attached to it rather than in place of it.
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(pass.locator('.stake-edge')).toContainText('%');
  await expect(pass.locator('.stake-pass-note')).toHaveText('no call');
  await expect(pass.locator('.stake-single input')).toHaveCount(1);
  await expect(pass.locator('.stake-odds input')).toHaveCount(1);

  // And staking one has to reach the risk read, or the lab is describing a
  // slip the reader is not holding.
  const before = await page.locator('.risk-exposure-cap').innerText();
  await pass.locator('.stake-single input').fill('12');
  await expect(page.locator('.risk-exposure-cap')).not.toHaveText(before);

  expect(errors).toEqual([]);
});

test('dragging a match from the bench adds it to the picks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/risk');
  if (await skipUnlessPriced(page, errors)) return;

  const picks = page.locator('.stake-row:not(.stake-row-head):not(.stake-row-parlay):not(.stake-row-none)');
  const bench = page.locator('.card-rail-item');
  if (await bench.count() === 0) { expect(errors).toEqual([]); return; }
  // Dragging is a Custom gesture: in Recommended the drop zone refuses, so
  // the bench cannot edit a selection the plan is about to rewrite.
  await page.getByRole('tab', { name: 'Custom' }).click();
  const n = await picks.count();

  // Real DragEvents with a real DataTransfer, dispatched at the elements.
  // Playwright's synthesized mouse cannot drive Chromium's native drag loop -
  // dragstart fires and no dragover ever reaches the drop zone - so a mouse
  // drag here would prove nothing about this code either way. This exercises
  // the parts we own: the payload the rail puts on the wire, the drop zone
  // accepting it, and the match moving across.
  const wire = await page.evaluate(() => {
    const item = document.querySelector('.card-rail-item');
    const zone = document.querySelector('.stake-table');
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    zone.dispatchEvent(over);
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { types: [...dt.types], accepted: over.defaultPrevented };
  });

  // The drop zone must say yes, or the browser shows a "no entry" cursor and
  // silently drops nothing.
  expect(wire.accepted).toBe(true);
  expect(wire.types).toContain('application/x-smash-match');
  await expect(picks).toHaveCount(n + 1);

  expect(errors).toEqual([]);
});
