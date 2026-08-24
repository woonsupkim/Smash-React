// src/utils/bracketViews.js
//
// Splits a bracket into the sub-brackets a page can actually render.
//
// Above this many slots the bracket is shown a quarter at a time. A 64-slot
// draw is 32 first-round boxes stacked - about 4,200px of column - and at 128
// it is twice that again: legible only if you scroll past the thing you are
// comparing. Splitting on the draw's own quarters is not an arbitrary page
// size, it is how the structure already divides, and it is how people fill a
// bracket in the first place. The fifth view picks the four quarter winners up
// and plays the semis and final between them.
export const SEGMENT_ABOVE = 16;

// Sub-brackets to render for a draw of `slots`, each one a self-contained
// bracket described by where it starts in the tree.
//   roundFrom  - global round index this view's first column shows
//   slotStart  - index into that round's array where the view begins
//   slotCount  - how many players the view's first column holds
// A single unsegmented view is exactly the old behaviour, so small draws
// render byte-for-byte as before.
export function bracketViews(slots) {
  if (slots <= SEGMENT_ABOVE) {
    return [{ id: 'all', label: 'Whole bracket', roundFrom: 0, slotStart: 0, slotCount: slots, terminal: 'champion' }];
  }
  const quarterSize = slots / 4;
  const finalsFrom = Math.log2(quarterSize);
  const views = [];
  for (let q = 0; q < 4; q++) {
    views.push({
      id: `q${q}`,
      label: `Quarter ${q + 1}`,
      roundFrom: 0,
      slotStart: q * quarterSize,
      slotCount: quarterSize,
      // The winner of a quarter is a semi-finalist, not a champion, so the
      // terminal column says so instead of crowning four people.
      terminal: 'semifinalist',
    });
  }
  views.push({
    id: 'finals',
    label: 'Semis & Final',
    roundFrom: finalsFrom,
    slotStart: 0,
    slotCount: 4,
    terminal: 'champion',
  });
  return views;
}
