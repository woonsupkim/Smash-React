// Automated accessibility audit (axe-core) over the key pages. Gates on
// SERIOUS and CRITICAL violations only: the dark theme's decorative muted
// text intentionally trades some contrast for hierarchy, and gating on
// "moderate" would drown real regressions in that noise.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const PAGES = [
  ['/', 'home'],
  ['/track-record', 'track record'],
  ['/h2h?surface=hard', 'h2h studio'],
  ['/model', 'model card'],
  ['/player/atp/sinne', 'player page'],
  ['/today', 'today'],
  ['/pickem', 'pickem'],
  ['/rivalries', 'rivalries board'],
  ['/rivalry/atp/jannik-sinner-vs-alexander-zverev', 'rivalry page'],
];

for (const [path, name] of PAGES) {
  test(`axe: no serious or critical violations on ${name}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).analyze();
    const gated = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    const summary = gated.map((v) => `${v.impact}: ${v.id} x${v.nodes.length} (${v.nodes[0]?.target})`).join('\n');
    expect(gated, summary).toEqual([]);
  });
}
