# Cloud pools setup (Supabase)

The app runs fully without this: pools fall back to per-device localStorage.
Completing these steps turns on accounts and cloud pools (cross-device,
real lock integrity, shared standings).

## 1. Create the project (~3 minutes)

1. Go to [supabase.com](https://supabase.com), sign in, and create a new
   project (free tier is fine). Pick any strong database password; the app
   never uses it directly.
2. In the dashboard, open **SQL Editor -> New query**, paste the contents of
   `supabase/schema.sql`, and click **Run**. It creates two tables with
   row-level security that makes locked brackets immutable.

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

## What changes when it's on

- A **Sign in** button appears in the navbar (magic-link email).
- Locking a bracket in Pool Play creates a real pool row; the share link
  becomes a short `?pool=<id>` URL instead of encoding the whole bracket.
- Friends' standings live in one shared pool, visible to anyone with the
  link, and enterable by anyone signed in.
- Locked entries cannot be edited or deleted by anyone, including their
  owner: the no-update/no-delete policy is the lock.

The `anon` key is safe to ship in the client bundle; row-level security is
the actual boundary. Never put the `service_role` key in the frontend.
