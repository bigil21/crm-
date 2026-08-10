# Supabase Setup

1. Copy `.env.example` to `.env`.
2. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from your Supabase project API settings.
3. In Supabase Dashboard > SQL Editor, run `supabase/schema.sql`.
   This creates the CRM state, admin, and durable conversation-message tables and can be rerun safely after updates.
4. In Supabase Auth settings, add these redirect URLs:
   - `http://localhost:4173/login`
   - Your production `/login` URL when deployed.
   These redirects are used for account confirmation, magic links, and password recovery.
5. Invite or create users with `@coastalcrestroofing.com` email addresses only.
6. Add the owner email to Render's `ADMIN_EMAILS` environment variable.
7. Add the owner email to the Supabase admin list by running this in SQL Editor after the owner account exists:

```sql
insert into public.crm_admins (email)
values ('owner@coastalcrestroofing.com')
on conflict (email) do nothing;
```

8. Assign one of these role values in each user's Supabase app metadata:
   - `admin`
   - `office_manager`
   - `sales_manager`
   - `operations_manager`
   - `sales`
   - `production`
   - `viewer`

The CRM trusts roles from `app_metadata.role`. Users listed in `ADMIN_EMAILS` or `public.crm_admins` are treated as admins.
Role values may also be entered with spaces or hyphens, such as `Sales Manager`; the app normalizes them to `sales_manager`.

The login page also includes a Create Account button. It only accepts `@coastalcrestroofing.com` emails and creates users with `DEFAULT_AUTH_ROLE` until an admin updates their role in Supabase.

Set `AUTH_REQUIRED=true` and `SUPABASE_SYNC_ENABLED=true` when you are ready to use Supabase for CRM data. Leave `AUTH_REQUIRED=false` for local design/build work without signing in; cloud sync waits for a signed-in company user.

Legacy data remains in scoped `crm_state` rows as a migration and rollback bridge. The current schema stores each contact, job, estimate, task, document, conversation message, and audit event independently, with row-level access controls. Document bytes are stored in the private `crm-documents` bucket.

After the first manager login, run `supabase/go-live-verification.sql` to verify migrated counts, relationships, conversations, and recovery backups.

Manager access:
- `office_manager` can manage team records, estimates, documents, tasks, and company settings.
- `sales_manager` can manage team leads, contacts, jobs, estimates, tasks, and sales reports.
- `operations_manager` can manage team jobs, projects, documents, tasks, and operational reports.
