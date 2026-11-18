import { createClient } from '@supabase/supabase-js'

// Publishable key: public by design, RLS protects the data.
export const supabase = createClient(
  'https://hyeslwlewvvjiyizoduf.supabase.co',
  'sb_publishable_de6tynv8AkIVfS9U5HYxyA_8NMR4tLo',
  { auth: { flowType: 'pkce' }, db: { schema: 'childmonitor' } },
)
