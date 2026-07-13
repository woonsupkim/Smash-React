// src/lib/supabase.js
//
// Single Supabase client for the whole app. Cloud features (accounts, cloud
// pools) light up only when both env vars are present; otherwise every
// consumer falls back to its localStorage behavior, so the app runs fully
// without a backend configured.
//
// Setup: create a free project at supabase.com, run supabase/schema.sql in
// its SQL editor, then put the project URL + anon key in .env (see
// .env.example) and restart the dev server / redeploy.
import { createClient } from '@supabase/supabase-js';

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const cloudEnabled = !!supabase;
