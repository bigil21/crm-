# JobCrest native integration roadmap

The purchased Perfex package is a workflow reference only. JobCrest keeps its
current interface, Supabase authorization model, private storage, and original
Node/browser implementation.

1. **Tasks, milestones, and activity** — enhanced tasks, recurrence, checklists,
   followers, comments, job milestones, and unified lead/job activity.
2. **Revenue and financial control** — estimate-to-invoice, allocations,
   expenses, credits, refunds, taxes, aging, recurring invoice drafts, reminder
   queue, and job financial reconciliation.
3. **Project delivery** — job templates, members, discussions, internal notes,
   timers, timesheets, and billable time.
4. **Lead organization** — configurable sources, tags, custom fields, saved
   filters, assignment alerts, and web-to-lead intake definitions.
5. **Communication automation** — email templates, scheduled delivery, durable
   retry queue, reminders, notification center, and audit status.
6. **Document operations** — customer visibility, comments, relations, immutable
   versions, reusable templates, smart documents, and signature handoff.
7. **Reports and goals** — income versus expense, source conversion, rep
   performance, payment methods, aging, billable time, and drill-down exports.
8. **Administration** — tax rates, payment methods, task/project templates,
   granular role capabilities, announcements, and operational settings.
9. **Customer portal** — branded authenticated access to estimates, contracts,
   invoices, payments, documents, and messages with customer-scoped RLS.

Every step is implemented locally first. Production deployment is a separate,
explicitly authorized action after migrations, permissions, recovery tests, and
browser verification pass.

## Local completion status — October 27, 2026

- Steps 1–9 are implemented in the local workspace.
- New relational migrations are replay-safe and protected by explicit grants
  and row-level security.
- The complete 966-test regression suite passes locally.
- Reports, administration controls, customer invitations, and the customer
  portal were verified through the local browser at port 4180.
- No production database migration or live deployment was performed.
