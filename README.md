# childMonitor

Parental monitoring for Windows laptops: a per-device agent uploads app and browser usage to Supabase (schema `childmonitor`), and a parent dashboard reads it under RLS (admin only).

Apply the SQL from `~/GitReposGeneral/itaibechor`:
`SUPABASE_ACCESS_TOKEN=sbp_... scripts/add-app.sh childmonitor 'https://itaibech.github.io/childMonitor/**' -- ../childMonitor/supabase/childmonitor.sql`

Local test: `npx supabase start`, load `supabase/local/stub_is_admin.sql` then `supabase/childmonitor.sql` into the local DB (port 55322), then `npx supabase test db`.
