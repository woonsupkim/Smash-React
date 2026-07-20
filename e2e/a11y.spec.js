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
  ['/edge', 'edge board'],
  ['/oddsle', 'oddsle'],
  ['/gym', 'model gym'],
  ['/compare/atp/jannik-sinner-vs-carlos-alcaraz', 'compare page'],
  ['/season', 'season rewind'],
  ['/challenge', 'bracket challenge'],
];

for (const [path, name] of PAGES) {
  test(`axe: no serious or critical violations on ${name}`, async ({ page }) => {
    // Pre-seed the intro-seen flag: the home hero's once-per-browser fade-in
    // otherwise races axe, which reads mid-animation opacity as a contrast
    // failure (flaky under load, not a real violation).
    await page.addInitScript(() => { try { localStorage.setItem('smash_intro_seen', '1'); } catch { /* private mode */ } });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).analyze();
    const gated = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    const summary = gated.map((v) => `${v.impact}: ${v.id} x${v.nodes.length} (${v.nodes[0]?.target})`).join('\n');
    expect(gated, summary).toEqual([]);
  });
}
