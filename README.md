# JobCrest CRM

A local installable CRM app for leads, customers, and contractor estimates.

## Run

```powershell
npm start
```

Then open `http://localhost:4173`.

## Make It Public

See `DEPLOYMENT.md` for the public hosting checklist. The app is now packaged as a Node web service with `npm start`.

## Supabase

The CRM can run locally or sync shared CRM data through Supabase.

1. Copy `.env.example` to `.env`.
2. Add your Supabase project URL and anon key.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Restart `node server.js`.

## What it does

- Saves leads, customers, estimates, company documents, calendar tasks, and company settings locally or through Supabase sync.
- Builds each lead's document folders from administrator-managed Document Categories in CRM Settings. Categories are shared configuration stored in the existing company JSON state, so adding categories never requires a schema or code change.
- Migrates legacy lead documents to stable category IDs automatically and records lead ID, category ID, file metadata, uploader, upload date, size, and version on every lead document.
- Stores project-conversation messages as individual Supabase rows, retains legacy messages during migration, and shows saving, saved, local-only, or retry states in the conversation feed.
- Stores contacts, jobs, estimates, tasks, documents, and activity history as independent durable rows so unrelated multi-user saves cannot overwrite one another.
- Uploads document bytes to a private Supabase Storage bucket and uses short-lived signed download links; legacy inline documents migrate automatically.
- Creates daily manager recovery snapshots and exposes `/api/health` for deployment monitoring.
- Builds an AccuLynx-inspired contractor estimate with customer/job information, scope, itemized costs, totals, terms, and signature lines.
- Opens an email draft from the selected estimate.
- Prints the estimate cleanly so it can be saved as a PDF.
- Includes a manifest and service worker so it can be installed from the browser when served from localhost.
- Includes PNG app icons for install support.

Run `npm run check:go-live` for the local architecture check. See `GO_LIVE_RUNBOOK.md` for migration, 190-lead verification, pilot, and deployment gates.
