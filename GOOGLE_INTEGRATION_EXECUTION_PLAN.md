# JobCrest Google Workspace integration execution plan

This plan keeps JobCrest as the system of record. Google products receive
purpose-specific copies, reminders, messages, or directory updates. Each
connector must be independently enabled and must fail without deleting or
corrupting the CRM record.

## Delivery order

1. **Foundation and least-privilege OAuth**
   - Preserve the existing Calendar and Gmail scopes.
   - Add optional product scopes for Tasks and Contacts.
   - Expose per-product readiness in Settings.
   - Store refresh tokens only in the encrypted server-side connection table.

2. **Company Shared Drive**
   - Reuse the existing `Lead > Project > Category` folder implementation.
   - Add a connection diagnostic that verifies the configured root folder.
   - Keep immutable document versions and company ownership.

3. **Google Docs templates**
   - Copy an administrator-selected Google Docs template into the job folder.
   - Merge allow-listed lead, job, estimate, and company fields.
   - Save the generated document link back to the CRM record.

4. **Google Sheets reporting**
   - Export filtered pipeline, financial, payment, and rep-performance rows.
   - Use batched writes and treat Sheets as a reporting destination only.
   - Store the spreadsheet ID and last-export time in company settings.

5. **Google Tasks and Meet**
   - Mirror CRM tasks to a dedicated JobCrest task list.
   - Preserve CRM ownership and sync completion without duplicate tasks.
   - Optionally create a Google Meet conference on Calendar appointments.

6. **Google Contacts**
   - Let a user copy an accessible lead into their own Google Contacts.
   - Store the Google resource name on the lead to support safe updates.

7. **Google Chat**
   - Send allow-listed operational notifications through a protected webhook.
   - Never send customer-sensitive notes, document contents, or payment data.

8. **Automatic Gmail reply capture**
   - Register Gmail watches and receive Pub/Sub notifications server-side.
   - Refresh watches before expiration and reconcile only known CRM threads.
   - Keep polling as a safe fallback.

9. **Google Groups onboarding**
   - Add invited employees to administrator-approved groups only.
   - Require domain-wide delegation and an explicit allow-list of group emails.
   - Make group assignment non-blocking so CRM invitations still succeed.

## Release gates

- Unit and integration tests cover every provider request and failure mode.
- Supabase migrations are replay-safe, RLS-protected, and server-only where
  provider credentials or subscription state are stored.
- Local browser tests pass for administrator and sales-representative roles.
- Google Cloud scopes/APIs and Render secrets are configured without committing
  credentials.
- Production is deployed only after health checks and live connector status
  checks pass.

