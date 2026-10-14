# Authentication Setup

## New project

1. Create the Supabase project and configure the production Site URL and allowed `/login` redirects.
2. For an empty project, apply `supabase/schema.sql`, then later files in `supabase/migrations` in order.
3. Set the server and public values described in `.env.example`.
4. Invite or create company users. Keep email confirmation enabled.
5. Explicitly approve each user and assign a server-owned role in `public.crm_user_access`.

Example owner approval after the Auth user exists:

```sql
insert into public.crm_user_access(user_id,email,role,approved,approved_at)
select id,lower(email),'admin',true,now()
from auth.users
where lower(email)='owner@coastalcrestroofing.com'
on conflict(user_id) do update
set email=excluded.email,role='admin',approved=true,approved_at=now(),updated_at=now();
```

Supported roles are `admin`, `office_manager`, `sales_manager`, `operations_manager`, `sales`, `production`, and `viewer`. Use canonical underscore values. The CRM trusts only approved rows in `public.crm_user_access`; signup metadata, the email domain, public configuration, and environment admin-email lists cannot promote a user.

The public Create Account action creates only an Auth identity. It does not approve CRM access. A pending user receives an approval-required message and remains signed out.

## Existing project

Take a backup and apply reviewed migrations in order. Do not rerun an older `schema.sql` snapshot over a database that already has migrations. Legacy data conversion is a separate reviewed maintenance operation and never runs automatically on manager login.

After migration, run `supabase/go-live-verification.sql`, then test an admin, manager, sales, production, viewer, and unapproved account. Confirm both browser controls and database writes match the intended role boundaries.
