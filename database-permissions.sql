-- PHASE SHIFT STUDIO — DATA API PERMISSIONS
-- Run only if the browser app reports permission denied / insufficient privilege.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.enquiries to authenticated;
grant select, insert, update, delete on table public.quotes to authenticated;
grant select, insert, update, delete on table public.quote_items to authenticated;

-- RLS policies remain the actual row-level security boundary.
