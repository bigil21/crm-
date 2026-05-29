# Roofline CRM

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
- Builds an AccuLynx-inspired contractor estimate with customer/job information, scope, itemized costs, totals, terms, and signature lines.
- Opens an email draft from the selected estimate.
- Prints the estimate cleanly so it can be saved as a PDF.
- Includes a manifest and service worker so it can be installed from the browser when served from localhost.
- Includes PNG app icons for install support.
