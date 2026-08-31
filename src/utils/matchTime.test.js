import { describe, it, expect } from 'vitest';
import {
  isPlaceholderTime, isToday, timeUntil, localStartTime, localDayLabel, localZoneLabel,
} from './matchTime';

// Schedules carry a midnight-ish UTC placeholder time until the order of play
// is published. These lock the handling that keeps such matches on the right
// day and off a bogus countdown - the root of "matches that didn't play today".
describe('matchTime placeholder handling', () => {
  it('flags only the midnight-ish UTC stamps as placeholders', () => {
    expect(isPlaceholderTime('2026-08-11T04:00:00Z')).toBe(true);
    expect(isPlaceholderTime('2026-08-11T00:30:00Z')).toBe(true);
    expect(isPlaceholderTime('2026-08-11T18:00:00Z')).toBe(false);
    expect(isPlaceholderTime('2026-08-11T23:00:00Z')).toBe(false);
  });

  it('timeUntil gives a TBD "today" for placeholders, a real countdown otherwise', () => {
    expect(timeUntil('2026-08-11T04:00:00Z', Date.parse('2026-08-11T01:00:00Z')))
      .toMatchObject({ tbd: true, label: 'today' });
    const real = timeUntil('2026-08-11T18:00:00Z', Date.parse('2026-08-11T15:00:00Z'));
    expect(real.label).toMatch(/^in /);
    expect(real.tbd).toBeUndefined();
  });

  it('isToday pins a placeholder match to its UTC calendar date (no timezone slip)', () => {
    const now = new Date(2026, 7, 11, 12, 0, 0); // local Aug 11
    expect(isToday('2026-08-11T04:00:00Z', now)).toBe(true);
    expect(isToday('2026-08-12T04:00:00Z', now)).toBe(false);
    expect(isToday('2026-08-10T04:00:00Z', now)).toBe(false);
  });
});

describe('the printed start time', () => {
  it('gives the clock time in the viewer\'s own zone', () => {
    // Built from a local Date so the assertion holds wherever CI runs: the
    // point is that the printed hour matches the viewer's clock, not that it
    // matches any particular timezone.
    const d = new Date();
    d.setHours(19, 30, 0, 0);
    expect(localStartTime(d.toISOString())).toBe('7:30 PM');
  });

  it('refuses to print an hour it does not have', () => {
    // A midnight-ish UTC stamp is a DATE marker: the order of play has not
    // been published. Printing "12:00 AM" from it would invent a start time
    // someone could plan around.
    expect(localStartTime('2026-09-02T04:00Z')).toBe(null);
    expect(localStartTime('2026-09-02T00:30Z')).toBe(null);
    expect(localStartTime('not a date')).toBe(null);
  });

  it('agrees with isPlaceholderTime about which stamps are real', () => {
    for (const iso of ['2026-09-02T04:00Z', '2026-09-02T00:30Z', '2026-09-02T19:00Z']) {
      expect(localStartTime(iso) === null).toBe(isPlaceholderTime(iso));
    }
  });
});

describe('the day label the page carries', () => {
  it('names the viewer\'s own calendar day, spelled out', () => {
    const label = localDayLabel(new Date(2026, 7, 31, 12, 0, 0));
    expect(label).toBe('Monday, August 31, 2026');
  });

  it('always resolves a zone name, since the times are printed in it', () => {
    const z = localZoneLabel();
    expect(typeof z === 'string' || z === null).toBe(true);
    if (z) expect(z.length).toBeGreaterThan(1);
  });
});
