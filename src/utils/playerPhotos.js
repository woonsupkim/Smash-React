// src/utils/playerPhotos.js
//
// One shared headshot lookup for the whole app (Home, Track Record, match
// and player pages). Same mechanism the brackets/H2H pages use: bundled
// per-tour photo maps with the bundled default avatar as fallback, so the
// fallback always ships to production.
//
// import.meta.glob (Vite) replaced webpack's require.context in the CRA to
// Vite migration; eager+url gives the same "map of id -> asset url" shape.
import defaultAvatar from '../assets/player-default.png';

const atpFiles = import.meta.glob('../assets/players/*.png', { eager: true, query: '?url', import: 'default' });
const wtaFiles = import.meta.glob('../assets/players-women/*.png', { eager: true, query: '?url', import: 'default' });

const toIdMap = (files) => {
  const map = {};
  for (const [path, url] of Object.entries(files)) {
    const id = path.split('/').pop().replace(/\.png$/, '');
    map[id] = url;
  }
  return map;
};

const photos = { atp: toIdMap(atpFiles), wta: toIdMap(wtaFiles) };

export function playerPhoto(tour, id) {
  return photos[tour === 'wta' ? 'wta' : 'atp'][id] || defaultAvatar;
}

export { defaultAvatar };
