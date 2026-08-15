-- Lock down internal functions flagged by the Supabase security advisor.

-- Trigger functions: never callable via RPC.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function seed_pipeline_stages() from public, anon, authenticated;
revoke execute on function touch_updated_at() from public, anon, authenticated;

-- RLS helper: policies evaluate it with the caller's privileges, so
-- authenticated (dashboard users) and service_role keep EXECUTE; anon and
-- blanket PUBLIC do not.
revoke execute on function is_workspace_member(uuid) from public, anon;
grant execute on function is_workspace_member(uuid) to authenticated, service_role;

-- Pin search_path on the remaining mutable-path function.
alter function touch_updated_at() set search_path = public;
