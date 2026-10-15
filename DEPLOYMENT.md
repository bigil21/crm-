# Public Deployment Checklist

JobCrest runs as a long-lived Node web service on Render.

## Render service

- Runtime: Node
- Build command: `npm ci`
- Start command: `npm start`
- Health path: `/api/health`

Configure production values from `.env.example` in Render. Require authentication, enable Supabase synchronization, use the private database credential only on the server, and configure Square and integration secrets only when those services are enabled. Never commit `.env` files or private credentials.

## Database rollout

1. Take and verify a production backup.
2. Apply reviewed files from `supabase/migrations` in order. Do not rerun an old schema snapshot over a migrated database.
   Several files share a date prefix, so sorting by name is not enough: apply `20260915_square_webhook_inbox.sql` before `20260915_square_payment_reconciliation.sql` (the second depends on the first).
   Apply `20261015120000_smart_document_single_email_send.sql` to stop two people emailing the same Smart Document at once.
3. Keep the `crm-documents` bucket private.
4. Verify durable record counts, relationships, storage paths, conversations, audit history, and recovery backups with `supabase/go-live-verification.sql`.

## Authentication and roles

An Auth account and a company-domain email are not sufficient for CRM access. Every user needs an explicitly approved `public.crm_user_access` row.

- `admin`: all CRM and company settings
- `office_manager`: team business records; company settings remain admin-only
- `sales_manager`: team leads, jobs, estimates, documents, tasks, and sales activity
- `operations_manager`: team contacts, jobs, documents, tasks, financial details, and email; no estimates or company settings
- `sales`: assigned leads, jobs, estimates, documents, tasks, and email
- `production`: assigned jobs, documents, and tasks
- `viewer`: read-only

JWT user metadata, environment admin-email lists, and browser configuration do not grant or promote roles.

## Release gate

Run `npm ci`, `npm run check:go-live`, and the local browser pilot. Review the diff, migration plan, and rollback plan. Push and deploy only after explicit approval. After Render reports healthy, verify sign-in, role boundaries, one full lead workflow, estimate PDF generation, document upload/download, payment refresh, and `/api/health` on the production domain.

## Vercel (alternative to Render)

`vercel.json` routes every request through `api/index.js` so sign-in, the APIs, OAuth callbacks and the Square webhook work, and only the allowlisted browser files are served. Background jobs do not run on Vercel: the Square payment worker and the daily recovery backup only run under `npm start` (Render). On Vercel the browser reads Square balances directly instead, and recovery backups need Render or a scheduled job.
