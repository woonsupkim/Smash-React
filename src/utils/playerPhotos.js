// src/utils/playerPhotos.js
//
// One shared headshot lookup for the whole app (Home, Track Record, match
// and player pages). Same mechanism the brackets/H2H pages use: bundled
// per-tour photo contexts with the bundled default avatar as fallback, so
// the fallback always ships to production.
import defaultAvatar from '../assets/player-default.png';

const contexts = {
  atp: require.context('../assets/players', false, /\.png$/),
  wta: require.context('../assets/players-women', false, /\.png$/),
};

export function playerPhoto(tour, id) {
  const ctx = contexts[tour === 'wta' ? 'wta' : 'atp'];
  const key = `./${id}.png`;
  return ctx.keys().includes(key) ? ctx(key) : defaultAvatar;
}

export { defaultAvatar };
