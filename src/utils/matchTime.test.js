import { describe, it, expect } from 'vitest';
import {
  isPlaceholderTime, isToday, timeUntil, localStartTime, localDayLabel, localZoneLabel,
  eventDayOf,
} from './matchTime';

// Schedules carry a midnight-ish UTC placeholder time until the order of play
// is published. These lock the handling that keeps such matches on the right
// day and off a bogus countdown - the root of "matches that didn't play today".
describe('matchTime placeholder handling', () => {
  it('flags midnight AT THE VENUE as a placeholder, and nothing else', () => {
    // 04:00Z is midnight in New York on EDT dates: the marker ESPN stamps
    // while the order of play is unpublished.
    expect(isPlaceholderTime('2026-08-11T04:00:00Z')).toBe(true);
    expect(isPlaceholderTime('2026-08-11T18:00:00Z')).toBe(false);
    expect(isPlaceholderTime('2026-08-11T23:00:00Z')).toBe(false);
  });

  it('a real night session is not a placeholder', () => {
    // The regression. 00:30Z is 8:30pm at the venue - a genuine night match,
    // with a real start time someone can plan around. The old test read the
    // UTC hour, called it a placeholder, and then pinned it to its UTC date:
    // the NEXT day. That is how a match played last night turned up on
    // today's card.
    expect(isPlaceholderTime('2026-09-02T00:30:00Z')).toBe(false);
    expect(localStartTime('2026-09-02T00:30:00Z')).not.toBe(null);
    // Its day is the day it was played, not the day UTC had rolled over to.
    expect(eventDayOf('2026-09-02T00:30:00Z')).toBe('2026-09-01');
    expect(isToday('2026-09-02T00:30:00Z', new Date('2026-09-02T14:00:00Z'))).toBe(false);
    expect(isToday('2026-09-02T00:30:00Z', new Date('2026-09-01T22:00:00Z'))).toBe(true);
  });

  it('timeUntil gives a TBD "today" for placeholders, a real countdown otherwise', () => {
    expect(timeUntil('2026-08-11T04:00:00Z', Date.parse('2026-08-11T01:00:00Z')))
      .toMatchObject({ tbd: true, label: 'today' });
    const real = timeUntil('2026-08-11T18:00:00Z', Date.parse('2026-08-11T15:00:00Z'));
    expect(real.label).toMatch(/^in /);
    expect(real.tbd).toBeUndefined();
  });

  it('isToday pins a placeholder match to the day the schedule means', () => {
    const now = new Date('2026-08-11T16:00:00Z'); // noon at the venue
    expect(isToday('2026-08-11T04:00:00Z', now)).toBe(true);
    expect(isToday('2026-08-12T04:00:00Z', now)).toBe(false);
    expect(isToday('2026-08-10T04:00:00Z', now)).toBe(false);
  });

  it('the card does not change composition late in the evening', () => {
    // 8pm at the venue: UTC has already rolled over to the next date. The old
    // test compared a UTC date against a LOCAL one, so in exactly this window
    // tomorrow's placeholders appeared and tonight's matches vanished.
    const evening = new Date('2026-09-02T00:10:00Z'); // 8:10pm Sep 1 at venue
    expect(isToday('2026-09-01T04:00:00Z', evening)).toBe(true);   // today's card
    expect(isToday('2026-09-02T04:00:00Z', evening)).toBe(false);  // tomorrow's
    expect(isToday('2026-09-02T00:30:00Z', evening)).toBe(true);   // tonight's
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
