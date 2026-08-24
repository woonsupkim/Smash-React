// data-pipeline/lib/seedOrder.js
//
// Standard tournament seeding order for any power-of-two draw, plus the
// qualifier padding a projected field needs.
//
// The seeding order is the sequence of SEED NUMBERS down the draw sheet, so
// that the top two seeds can only meet in the final, the top four only in the
// semis, and so on. It is built by the usual recursion: a draw of 2n is the
// draw of n with each seed x followed by its mirror (2n+1-x).
//
//   1              -> [1]
//   2              -> [1, 2]
//   4              -> [1, 4, 2, 3]
//   8              -> [1, 8, 4, 5, 2, 7, 3, 6]
//   16             -> [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]
//
// That 16 row is byte-identical to the SEED_ORDER_16 constant this replaces,
// which is what lets the full-draw work land without moving the existing
// 16-player projection.
//
// WHY PADDING. A real slam draw is 128 and our roster carries about 119
// players per tour, so a projected field is short by single digits. Rather
// than shrink the bracket to fit the roster (which stops being the
// tournament) the gaps are filled with neutral Qualifier entries placed at
// the WEAKEST seed positions - exactly where real qualifiers land. They are
// marked so every surface can label them as unknown rather than pretending
// a name, and they carry tour-average stats so the simulation treats them as
// a generic opponent instead of a bye.

// Seed order for a draw of `size` (must be a power of two).
function seedOrder(size) {
  if (!Number.isInteger(size) || size < 1 || (size & (size - 1)) !== 0) {
    throw new Error(`seedOrder: ${size} is not a power of two`);
  }
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    for (const seed of order) {
      next.push(seed, n + 1 - seed);
    }
    order = next;
  }
  return order;
}

// The largest power of two that is <= n, used to pick a projectable size when
// a full 128 cannot be justified.
const largestPowerOfTwo = (n) => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

// Places `ranked` (already sorted strongest-first) into a draw of `size`,
// padding with qualifier placeholders when the roster is short.
//
// Padding goes to the weakest seed numbers, so a projected US Open puts the
// qualifiers where qualifiers actually go - opposite the top seeds - rather
// than scattering them through the draw and handing a top seed an unearned
// easy quarter.
function buildSeededField(ranked, size, { qualifierName = 'Qualifier' } = {}) {
  const order = seedOrder(size);
  const bySeed = new Map();
  for (let seed = 1; seed <= size; seed++) {
    const p = ranked[seed - 1];
    bySeed.set(seed, p
      ? { ...p, seed, qualifier: false }
      : { id: `qual${seed}`, name: qualifierName, rank: 999, seed, qualifier: true });
  }
  return order.map((seed) => bySeed.get(seed));
}

module.exports = { seedOrder, buildSeededField, largestPowerOfTwo };
