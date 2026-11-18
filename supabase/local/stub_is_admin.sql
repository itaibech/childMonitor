-- Local-only stand-in for production's public.is_admin(). Not matched by pg_prove (*.test.sql).
create or replace function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true),'') = 'on' $$;
