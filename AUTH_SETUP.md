# Supabase Setup

1. Copy `.env.example` to `.env`.
2. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from your Supabase project API settings.
3. In Supabase Dashboard > SQL Editor, run `supabase/schema.sql`.
4. In Supabase Auth settings, add these redirect URLs:
   - `http://localhost:4173/login`
   - Your production `/login` URL when deployed.
5. Invite or create users with `@coastalcrestroofing.com` email addresses only.
6. Assign one of these role values in each user's Supabase user metadata or app metadata:
   - `admin`
   - `sales`
   - `production`
   - `viewer`

The CRM reads roles in this order: `app_metadata.role`, then `user_metadata.role`, then `DEFAULT_AUTH_ROLE`.

The login page also includes a Create Account button. It only accepts `@coastalcrestroofing.com` emails and creates users with `DEFAULT_AUTH_ROLE` until an admin updates their role in Supabase.

Set `AUTH_REQUIRED=true` and `SUPABASE_SYNC_ENABLED=true` when you are ready to use Supabase for shared CRM data. Leave `AUTH_REQUIRED=false` for local design/build work without signing in; cloud sync waits for a signed-in company user.

The first signed-in company user who opens the CRM seeds the `crm_state` row from the current local CRM data. After that, CRM changes are saved to Supabase and pushed to other open CRM sessions through Realtime.
