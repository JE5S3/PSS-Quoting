PHASE SHIFT STUDIO — SUPABASE QUOTE ADMIN

THIS VERSION
- Uses Supabase Auth for login.
- Uses the live Supabase customers, quotes and quote_items tables.
- Keeps only business display settings in localStorage.
- Keeps Stripe as a safe Payment Link field for now.
- Uses your publishable key in the browser (expected/safe with RLS).
- Does NOT contain a service_role key, database password or Stripe secret.

HOW TO TEST
1. Keep internet access available (the Supabase JS client loads from jsDelivr).
2. Open index.html in your browser.
3. Sign in with the Supabase Authentication user you created.
4. Create a quote and save it.
5. In Supabase Table Editor, confirm records appear in:
   - customers
   - quotes
   - quote_items

IF YOU GET "PERMISSION DENIED"
Your RLS policies are already created, but your project may also require authenticated Data API grants.
Run the included database-permissions.sql in Supabase SQL Editor.

NEXT PRODUCTION STEP
Host this at admin.phaseshiftstudio.com.au.
After that:
- connect the public enquiry form to the enquiries table through an Edge Function,
- add an AI draft quote function,
- optionally add Cloudflare Access as a second access gate.
