-- MIGRATION (run once on the existing project): personal pick'em recap
-- pushes. Adds an OPTIONAL user link to push subscriptions - signed-in
-- subscribers get "you went 3-1 yesterday" instead of the generic headline.
-- Anonymous subscriptions keep working exactly as before (user_id null).
-- Fresh installs get this column from push.sql / setup_all.sql directly.

alter table public.push_subscriptions
  add column if not exists user_id uuid references auth.users (id);
