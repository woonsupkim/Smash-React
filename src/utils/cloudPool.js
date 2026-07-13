// src/utils/cloudPool.js
//
// Data access for cloud-backed bracket pools (Supabase). Entry shape matches
// the localStorage pools in bracketPool.js: { name, lockedAt, slots, picks },
// so DreamBrackets renders both sources through the same standings code.
import { supabase } from '../lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPoolId = (s) => UUID_RE.test(s || '');

const rowToEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.display_name,
  lockedAt: row.locked_at,
  slots: row.slots,
  picks: row.picks,
  isGhost: row.is_ghost,
});

// Creates the pool plus the creator's entry and the model ghost in one go.
export async function createPoolWithEntries(key, userId, entry, ghostPicks) {
  const { data: pool, error: poolErr } = await supabase
    .from('pools')
    .insert({ key, name: `${entry.name}'s pool`, created_by: userId })
    .select()
    .single();
  if (poolErr) throw poolErr;

  const rows = [
    {
      pool_id: pool.id,
      user_id: userId,
      display_name: entry.name,
      is_ghost: false,
      slots: entry.slots,
      picks: entry.picks,
    },
    {
      pool_id: pool.id,
      user_id: null,
      display_name: 'Smash Model',
      is_ghost: true,
      slots: entry.slots,
      picks: ghostPicks,
    },
  ];
  const { data: entries, error: entErr } = await supabase.from('pool_entries').insert(rows).select();
  if (entErr) throw entErr;
  return { pool, entries: entries.map(rowToEntry) };
}

// Joins an existing pool with the caller's locked bracket.
export async function joinPool(poolId, userId, entry) {
  const { data, error } = await supabase
    .from('pool_entries')
    .insert({
      pool_id: poolId,
      user_id: userId,
      display_name: entry.name,
      is_ghost: false,
      slots: entry.slots,
      picks: entry.picks,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToEntry(data);
}

export async function fetchPool(poolId) {
  const { data: pool, error: poolErr } = await supabase.from('pools').select().eq('id', poolId).single();
  if (poolErr) throw poolErr;
  const { data: rows, error: entErr } = await supabase
    .from('pool_entries')
    .select()
    .eq('pool_id', poolId)
    .order('locked_at', { ascending: true });
  if (entErr) throw entErr;
  return { pool, entries: rows.map(rowToEntry) };
}

// The signed-in user's most recent pool for this bracket context, so a
// locked cloud bracket survives reloads without needing the share link.
export async function fetchMyLatestPool(key, userId) {
  const { data, error } = await supabase
    .from('pool_entries')
    .select('pool_id, pools!inner(id, key, name, created_by, created_at)')
    .eq('user_id', userId)
    .eq('pools.key', key)
    .order('locked_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data?.length) return null;
  return fetchPool(data[0].pool_id);
}
