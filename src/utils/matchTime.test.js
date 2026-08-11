import { describe, it, expect } from 'vitest';
import { isPlaceholderTime, isToday, timeUntil } from './matchTime';

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
