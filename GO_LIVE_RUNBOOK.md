# CRM Go-Live Runbook

## 1. Local validation

Run `npm run check:go-live`, start the CRM, and open `/api/health`. The response must show `ok: true`.

## 2. Prepare Supabase

1. Take a Supabase project backup before changing production data.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Confirm the `crm-documents` bucket is private.
4. Confirm each salesperson has the correct role in Supabase app metadata.
5. Configure local `.env.local` with the production Supabase URL and publishable key only when ready for the controlled migration.

## 3. Migrate existing CRM data

1. Sign in locally as an administrator or manager.
2. The first signed-in load reads legacy `crm_state` rows and creates one durable row per contact, job, estimate, task, and document.
3. Existing conversation entries copy to the durable conversation table.
4. Existing inline documents move to the private Storage bucket; metadata remains in `crm_records`.
5. Keep legacy `crm_state` rows during the pilot as a rollback bridge.

## 4. Verify the expected 190 leads

Run `supabase/go-live-verification.sql`. Confirm the active contact count matches the expected 190 before accounting for intentional deletions or merged duplicates. Duplicate, orphan-job, and orphan-document queries must return no rows. Confirm a current-day recovery backup exists.

Compare five representative leads against the original source: contact details, assigned rep, job status/value, conversation history, estimates, and documents.

## 5. Sales-team pilot

Use two sales accounts and one manager account for one business day. Verify simultaneous edits to different leads, same-lead refresh behavior, task completion, estimate creation/PDF output, document upload/download, mobile layout, and logout/login persistence.

Do not begin the full rollout if any save shows a cloud failure or the durable contact count changes unexpectedly.

## 6. Publish and deploy

After the pilot passes, review the local diff, commit intentionally, push a `codex/` branch, open a pull request, deploy to Render, verify `/api/health`, and rerun the production verification SQL. GitHub and Render remain untouched until explicitly approved.
