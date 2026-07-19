# Cloud setup (Supabase + web push)

The app runs fully without this: pools fall back to per-device localStorage,
pick'em and the Bracket Challenge explain themselves and show the model's
side, and the push toggle hides itself. Completing these steps turns on
accounts, cloud pools, the pick'em leaderboard, saved Bracket Challenge
entries, and upset-alert notifications.

## 1. Create the project (~3 minutes)

1. Go to [supabase.com](https://supabase.com), sign in, and create a new
   project (free tier is fine). Pick any strong database password; the app
   never uses it directly.
2. In the dashboard, open **SQL Editor -> New query**, paste the contents of
   `supabase/setup_all.sql` (everything in one paste: pools, pick'em,
   bracket challenge, push subscriptions), and click **Run**. Every game
   table is insert-only under row-level security - locks are enforced by
   the database, not the UI.

## 2. Configure auth

1. **Authentication -> Providers -> Email**: leave Email enabled. Magic links
   work out of the box; no other provider is needed.
2. **Authentication -> URL Configuration**: set the Site URL to your deployed
   domain (and add `http://localhost:3000` to additional redirect URLs for
   local dev).

## 3. Wire the keys

1. **Project Settings -> API**: copy the Project URL and the `anon` public key.
2. Locally: copy `.env.example` to `.env` and fill both values, then restart
   `npm start`.
3. On Vercel: add the same two variables under Project -> Settings ->
   Environment Variables and redeploy.

## 4. Upset alerts (web push, optional)

The VAPID keypair already lives in the local `.env` (generated with
`npx web-push generate-vapid-keys`; regenerate the same way if it's ever
lost - subscribers would simply re-subscribe).

Where each value goes:

| Value | GitHub secret (repo Settings -> Secrets -> Actions) | Vercel env var |
|---|---|---|
| VAPID public key | `VAPID_PUBLIC_KEY` | `REACT_APP_VAPID_PUBLIC_KEY` |
| VAPID private key | `VAPID_PRIVATE_KEY` | never |
| Contact (optional) | `VAPID_SUBJECT` (e.g. `mailto:you@example.com`) | - |
| Supabase project URL | `SUPABASE_URL` | `REACT_APP_SUPABASE_URL` |
| Supabase `service_role` key (Project Settings -> API) | `SUPABASE_SERVICE_KEY` | never |
| Supabase `anon` key | - | `REACT_APP_SUPABASE_ANON_KEY` |

After the Vercel vars are set, redeploy: the "Get upset alerts" pill
appears on the Today page. The refresh workflow's push step goes live the
moment the four GitHub secrets exist - at most one notification per day,
only for a called upset or a fresh bold underdog lock.

## What changes when it's on

- A **Sign in** button appears in the navbar (magic-link email).
- Locking a bracket in Pool Play creates a real pool row; the share link
  becomes a short `?pool=<id>` URL instead of encoding the whole bracket.
- Friends' standings live in one shared pool, visible to anyone with the
  link, and enterable by anyone signed in.
- Locked entries cannot be edited or deleted by anyone, including their
  owner: the no-update/no-delete policy is the lock.
- Pick'em picks save to the public leaderboard instead of being local-only.
- The Bracket Challenge accepts locked brackets and ranks everyone against
  the model when a slam's round of 16 is set.
- With the push secrets in place, subscribers get upset alerts from the
  daily refresh.

The `anon` key is safe to ship in the client bundle; row-level security is
the actual boundary. Never put the `service_role` key in the frontend.
