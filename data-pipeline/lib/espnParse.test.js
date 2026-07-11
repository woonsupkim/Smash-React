const test = require('node:test');
const assert = require('node:assert');
const { normName, normSurface, isGrandSlam, surfaceFromEventName, matchRoster } = require('./espnParse');

test('normName strips accents, hyphens, and case', () => {
  assert.strictEqual(normName('Félix Auger-Aliassime'), 'felix auger aliassime');
  assert.strictEqual(normName('Stefanos Tsitsipás'), 'stefanos tsitsipas');
  assert.strictEqual(normName('  Carlos   ALCARAZ '), 'carlos alcaraz');
});

test('normSurface canonicalizes labels', () => {
  assert.strictEqual(normSurface('Red clay'), 'clay');
  assert.strictEqual(normSurface('Grass'), 'grass');
  assert.strictEqual(normSurface('I.hard'), 'hard');
  assert.strictEqual(normSurface('Carpet'), 'hard');
  assert.strictEqual(normSurface(''), null);
  assert.strictEqual(normSurface(undefined), null);
});

test('isGrandSlam matches the four majors only', () => {
  assert.ok(isGrandSlam('Wimbledon'));
  assert.ok(isGrandSlam('Roland Garros'));
  assert.ok(isGrandSlam('US Open'));
  assert.ok(isGrandSlam('Australian Open'));
  assert.ok(!isGrandSlam('Miami Open'));
  assert.ok(!isGrandSlam(''));
});

test('surfaceFromEventName infers surface, defaulting to hard', () => {
  assert.strictEqual(surfaceFromEventName('Wimbledon'), 'grass');
  assert.strictEqual(surfaceFromEventName('Halle Open'), 'grass');
  assert.strictEqual(surfaceFromEventName('Roland Garros'), 'clay');
  assert.strictEqual(surfaceFromEventName('Rome Masters'), 'clay');
  assert.strictEqual(surfaceFromEventName('US Open'), 'hard');
  assert.strictEqual(surfaceFromEventName('Some Unknown 250'), 'hard');
});

test('matchRoster: exact normalized match wins', () => {
  const roster = [
    { id: 'alcar', name: 'Carlos Alcaraz', norm: normName('Carlos Alcaraz') },
    { id: 'sinne', name: 'Jannik Sinner', norm: normName('Jannik Sinner') },
  ];
  assert.strictEqual(matchRoster('Carlos Alcaraz', roster).id, 'alcar');
  // Accented / hyphenated ESPN spelling still resolves
  assert.strictEqual(matchRoster('Jannik  Sinner', roster).id, 'sinne');
});

test('matchRoster: unique last-name fallback, but ambiguous returns null', () => {
  const roster = [
    { id: 'cerud', name: 'Juan Manuel Cerundolo', norm: normName('Juan Manuel Cerundolo') },
    { id: 'ceruf', name: 'Francisco Cerundolo', norm: normName('Francisco Cerundolo') },
    { id: 'mus',   name: 'Lorenzo Musetti', norm: normName('Lorenzo Musetti') },
  ];
  // Unique last name resolves even without the full first name
  assert.strictEqual(matchRoster('L. Musetti', roster).id, 'mus');
  // Two Cerundolos -> ambiguous last name -> null (never guess)
  assert.strictEqual(matchRoster('Cerundolo', roster), null);
});
