-- MIGRATION (run once in the Supabase SQL editor on the existing project):
-- removes the over-permissive anonymous delete policy on push subscriptions.
-- `using (true)` let any anonymous caller delete ANY row (the endpoint
-- filter only existed client-side). Unsubscribing still works without it:
-- the browser-side unsubscribe stops delivery immediately, and the pipeline
-- sender prunes dead rows on 404/410 at the next send.
--
-- Only needed on projects that ran setup_all.sql / push.sql before this fix.

drop policy if exists "unsubscribe by endpoint" on public.push_subscriptions;
