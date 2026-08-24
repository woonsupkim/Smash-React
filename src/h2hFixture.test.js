// The head-to-head fixture key.
//
// Background, because the shape of these tests only makes sense with it: the
// published H2H records were inflated - Collignon vs Van Assche read 22-0
// against a true 3-0, Bonzi vs Riedi 14-0 against 2-0 - while Alcaraz vs
// Sinner was fine. Re-fetching the same players and running the identical
// code produced the correct numbers, which pinned it on the cached feed
// rather than the arithmetic: fetch.js keeps history forever and merged on
// the feed's match id, so a fixture re-issued under a new id was banked
// twice. Every copy names the same winner, so records stayed lopsided while
// counts climbed, and only pairs whose meetings were recent were affected.
//
// Deduping on pair+day instead of the feed's id is the fix at both layers.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fixtureKey } from '../data-pipeline/computeMatchupFacts';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('fixtureKey', () => {
  it('names a fixture independently of the feed id', () => {
    const a = { id: '1260010', player1Id: 84235, player2Id: 82371, date: '2026-04-10T00:00:00.000Z' };
    const reissued = { ...a, id: '9999999' };
    expect(fixtureKey(reissued)).toBe(fixtureKey(a));
  });

  it('is orientation-independent', () => {
    const base = { date: '2026-04-10T00:00:00.000Z' };
    expect(fixtureKey({ ...base, player1Id: 84235, player2Id: 82371 }))
      .toBe(fixtureKey({ ...base, player1Id: 82371, player2Id: 84235 }));
  });

  it('separates two meetings between the same pair on different days', () => {
    const p = { player1Id: 1, player2Id: 2 };
    expect(fixtureKey({ ...p, date: '2026-04-10T00:00:00.000Z' }))
      .not.toBe(fixtureKey({ ...p, date: '2026-03-12T00:00:00.000Z' }));
  });

  it('ignores the time of day, so a re-stamped kickoff is the same match', () => {
    const p = { player1Id: 1, player2Id: 2 };
    expect(fixtureKey({ ...p, date: '2026-04-10T00:00:00.000Z' }))
      .toBe(fixtureKey({ ...p, date: '2026-04-10T18:30:00.000Z' }));
  });

  it('returns null rather than a shared key for rows it cannot identify', () => {
    // Must not collapse every malformed row onto one key, which would delete
    // real matches instead of duplicates.
    expect(fixtureKey({ id: '1', player2Id: 2, date: '2026-04-10' })).toBeNull();
    expect(fixtureKey({ id: '1', player1Id: 1, date: '2026-04-10' })).toBeNull();
    expect(fixtureKey({ id: '1', player1Id: 1, player2Id: 2 })).toBeNull();
    expect(fixtureKey(null)).toBeNull();
  });
});

describe('both dedupe layers speak fixtures, not feed ids', () => {
  it('the cache merge in fetch.js keys on the fixture', () => {
    const src = read('data-pipeline/fetch.js');
    // An id-keyed merge is what banked the duplicate copies.
    expect(src).toMatch(/byFixture\.set\(fixtureKey\(m\), m\)/);
    expect(src).not.toMatch(/byId\.set\(String\(m\.id\), m\)/);
  });

  it('the incremental-stop check keys on the fixture too', () => {
    // Keyed by id, a re-issued fixture looks new every run, so the "this
    // page is all known" short-circuit never fires and each run re-pages the
    // whole window - which is what kept feeding the duplicates in.
    const src = read('data-pipeline/fetch.js');
    expect(src).toMatch(/knownIds = new Set\(existing\.map\(\(m\) => fixtureKey\(m\)\)\)/);
  });

  it('the h2h builder dedupes on the fixture', () => {
    const src = read('data-pipeline/computeMatchupFacts.js');
    expect(src).toMatch(/seenMatchIds\.add\(fixture\)/);
    expect(src).not.toMatch(/seenMatchIds\.add\(m\.id\)/);
  });
});
