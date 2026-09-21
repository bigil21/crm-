# Conflict-safe writes: review before deployment

Status: implemented locally and installed in the separate hosted test project;
NOT applied to production.

Latest addition: `20260914_versioned_company_settings.sql` and
`company-settings-writes.js` are LOCAL ONLY. The earlier two migrations are
installed in staging; this third migration is not yet installed there or live.
The current client requires all three before shared editing is certified.

Scope clarification: the subsequent `20260914_company_settings_permissions.sql`
has now also been installed and role-tested in hosted staging. Neither migration
is applied to production. The separate `staging/approved-sales-tester.sql` exception
is for one user in the test project only and must NEVER enter a production rollout.

Hosted checkpoint (2026-09-14): `crm testing` in `JobCrest CRM Testing` Free
organization, project reference `ixksmfiektzsunmmwejz`. Base schema and migration
installed after explicit approval. Ten hosted PostgreSQL/RLS smoke checks passed;
all synthetic users/records were rolled back and absence verified separately.
The installed save-function body matches local source after whitespace/comment
normalization. Real Auth sign-in, PostgREST authenticated calls, Storage API tests,
and production backup/restore verification remain pending.

The user explicitly authorized GitHub, Render, and live CRM deployment after
verification on 2026-09-14. Production rollout is authorized but remains gated on
the checks below; authorization is not a readiness certification. Do not deploy only
the frontend or only this migration during normal use: old clients write directly
to tables, while new clients require `crm_commit_records`.

## What changes

- Record writes compare the last-read version under a database row lock. Stale
  records reject the entire batch instead of overwriting newer work.
- The transaction includes record changes, mandatory audit history, optional
  user-visible events, and an idempotency receipt scoped to the signed-in actor.
- Direct authenticated record mutations are revoked. Authenticated company users
  retain normal record editing through the RPC; only trusted admins may change
  payment fields. Service-role credentials must never be exposed to the browser.
- Deletes become tombstones. Existing records are not backfilled or deleted.
- The client serializes writes, retains unsaved intent after a conflict/uncertain
  response, pauses retries, and provides a recovery download before reloading.
- Document removal retains file bytes. This is not yet a complete restore UI or
  separately scheduled provider/storage backup.
- The subsequent settings-permission migration adds restrictive policies:
  everyone in the company can still read settings; only database-recognized admins
  may create/update the company settings row. Non-admin managers retain ordinary
  lead/job/estimate editing. DELETE/TRUNCATE of legacy state are revoked.
- Durable-mode clients no longer send duplicate whole-company business snapshots.
  The old state table is read for company settings only; routine lead/job typing
  sends versioned record writes rather than a second full-data upload.
- Company settings now have their own versioned admin RPC, with immutable requests,
  stale-version rejection, idempotency receipts, previous-value history, and no
  direct-table fallback. Sales retain read access; even admins cannot bypass
  settings version checks. Legacy document metadata is retained, not overwritten.
- Jobs/documents without an active parent lead are retained as unmapped rows during
  hydration. Background saves must not infer deletion from their absence in the
  visible lead list or silently assign them to a different customer.
- `draft-recovery.js` checkpoints unconfirmed edits under company/user/page-specific
  keys. Startup offers earlier copies for export before replacing the disposable
  cache. Export acknowledgement cannot erase newer work from another tab. No
  automatic replay is performed. Browser quota failures display a persistent warning.
- `session-guard.js` binds an editor to its verified identity. Sign-out, account or
  role changes stop subsequent shared-data requests and hide the old editor. Requests
  already in flight may have committed; this is not server-side token revocation.

## Required preflight and staging verification

1. Review `record-write-preflight.sql` results against the intended Supabase project.
   This script is read-only. Investigate unexpected company IDs, invalid payloads,
   duplicates, or orphan records separately; do not silently repair historical data.
2. Verify trusted admin membership and JWT app-metadata roles. The migration uses
   the existing `is_crm_admin()` and company-scope functions; it does not redefine
   who is an admin. Browser-configured admin email lists alone are not sufficient.
3. Obtain a provider database backup and separate private-object backup. Verify a
   restore in an isolated project before claiming recoverability. Browser-generated
   daily snapshots are not a substitute for this step.
4. Apply the existing base schema then the new migration to an isolated Supabase
   project. Test through its actual Auth, PostgREST and Storage services with separate
   admin/sales accounts and two browser sessions. Confirm a stale payment save is
   rejected, ordinary sales checklist/cost/estimate edits work, dropped responses
   preserve recovery data, and direct table writes fail. Check role/extension grants
   in that environment, not only source files.
5. Test existing paid jobs and legacy payment shapes without modifying production.
   Sales clients preserve raw protected payment fields during normal edits.
6. Review polling/reconciliation: browser Square reconciliation now requires admin.
   Sales reps read confirmed balances via shared records. A durable, trusted server
   reconciliation worker and complete webhook/refund coverage remain audit work.
7. `npm test` uses real in-memory PostgreSQL (PGlite) and synthetic claims. It exercises
   stale-client interleavings and transactions, but is NOT a multi-connection lock
   stress test, hosted Supabase test, or provider backup/restore test.

## Coordinated live rollout (authorized after verification; not yet executed)

1. Announce a brief maintenance window and have users save/export pending work.
   Record the exact current app revision and verified backup identifiers.
2. Pause new writes, apply `migrations/20260914_conflict_safe_record_writes.sql` then
   `migrations/20260914_company_settings_permissions.sql`, then
   `migrations/20260914_versioned_company_settings.sql`, and deploy the compatible
   app including `record-writes.js`, `company-settings-writes.js`, `draft-recovery.js`, `session-guard.js` and their
   server allowlist entries. Verify settings remain readable by sales and writable
   only by administrators, without breaking normal lead/job editing.
3. Force old tabs to reload. Old clients must fail closed, not regain direct writes.
4. Repeat read-only preflight: commit function present, SELECT allowed, direct
   INSERT/UPDATE/DELETE denied. Verify newly saved versions and audit receipts using
   an explicitly approved test record, then verify it from another user session.
5. Resume use only after save/readback, payment authorization, document download,
   and stale-session tests pass on the intended deployment.

## Recovery / rollback

Do not restore the old direct-write privileges as an automatic rollback: that would
reopen payment bypass and lost-update defects. If rollout fails, pause editing,
retain receipts/tombstones/file versions and recovery downloads, and forward-fix
the compatible app or migration. A provider restore is a separate, explicitly
approved operation after examining writes made since the backup. The migration is
transactional and can be reapplied; tests verify reapplication does not alter
business rows. Re-running the older base schema is NOT an approved rollback.

Recovery downloads contain customer data. Keep them secure, review each proposed
change against the latest record, and reapply intentionally. There is no automatic
JSON re-import or blind replay after reload in this batch.

Further unresolved items include hosted verification of versioned admin settings
edits; logout cleanup/encryption of sensitive device recovery data; authenticated
cross-browser testing; durable provider reconciliation; database relationships and
number allocation; hosted Storage lifecycle rules; independent backup restoration;
and full performance profiling. This document does not certify launch readiness.

## Production read-only checkpoint (2026-09-14)

- Render service `srv-d8curst8nd3s73egob5g` serves `jobcrestcrm.com`, tracking
  `bigil21/crm-` main. Both GitHub main and Render are at
  `c8d4576593d1fde00e3a0ae917f935d44bf2ca8d`. Render auto-deploy is enabled;
  pushing main is a deployment action. Health-check path is currently blank in
  the dashboard, despite the local blueprint declaring `/api/health`.
- Live public configuration requires authentication and enables cloud sync for
  company `coastal-crest`, in the production project (not hosted staging).
- Provider daily database backups are listed through 2026-09-14 07:21:16 UTC.
  Their dashboard explicitly excludes Storage object bytes. No restore was run.
- Aggregate read-only SQL found 189 contacts, 190 jobs, 18 estimates, 11 documents,
  4 tasks, 16 conversation messages, and 103 audit events. All six existing CRM
  tables have RLS. No invalid record versions/payloads or other-company rows were
  counted. Duplicate lead-number groups and duplicate Square-invoice groups are
  zero in this query; one job/estimate has no active lead link and needs review.
  Follow-up classified it as an estimate with no linked job and no Square invoice
  ID. It was not deleted, reassigned, or restored automatically.
- Private bucket is configured for 262144000 bytes (250 MiB), with 13 stored
  objects. This does not prove upload completion or matching metadata/backup coverage.
- Neither new save RPC is installed live. Direct authenticated record mutations
  remain granted. This confirms a coordinated rollout is required.
- Repository is PUBLIC. Real staging account email/UID values have been removed
  from distributable SQL and tests: SQL uses placeholders, tests use synthetic
  identities. Review exact staged files for any other secrets/customer data before
  a push. Do not include ignored runtime settings or unrelated output/tmp.

These observations are not a release approval substitute or end-to-end sign-off.

## Additional local repair checkpoint (2026-09-15)

- Only the detached request acknowledged by the record writer may update its
  saved fingerprint. Removed duplicate acknowledgments that incorrectly marked
  later checkbox, cost, estimate and document edits as saved. Deletions made
  during an unrelated save now schedule a follow-up flush.
- Explicit estimate PDF saves capture their original estimate and association.
  Changing selection cannot export a different estimate or redirect a later view;
  typing during saving is not reported fully saved. PDF drawing layout is unchanged.
- Unsaved company-form fields survive unrelated renders and block remote baseline
  adoption. Drafts are local until explicit Save and are not replayed blindly on
  authenticated startup.
- `payment-refresh.js` batches reads, validates responses and associations, ignores
  outdated replies and keeps edited estimates untouched. Session changes prevent
  late application. CRM contract values are not replaced by provider invoice totals.
  Ship this helper with the app and server allowlist. Current app version is 131,
  service worker 138.
- Payment-status API reads only references visible to the verified caller, validates
  lead/job associations before Square, bounds concurrency at four and total lookup
  time at 40 seconds after authentication. It performs no database or provider writes.
  Public auth configuration and auth lookups reject secret/service-role keys.
- Invoice creation stops on customer/location failures, requires confirmed email
  delivery, checks provider amounts/currency/identifiers and uses scoped hashed
  operation keys. These are containment fixes, NOT durable invoice-send recovery.
- Latest local result: **288 executable tests passed**, **100 architecture checks
  passed**, syntax checks and tracked whitespace checks passed. Provider calls use
  mocks; SQL tests use PGlite/synthetic claims. No real invoice or email was sent.
- Chrome connection timed out twice on inventory, so this batch has no new browser
  interaction verification. Hosted login, Storage and real multi-user tests remain
  incomplete. No migrations, production changes, GitHub push or deployment occurred.

### Square release blockers still open

1. Creation still needs a trusted saved Won-estimate/lead/job lookup and immutable,
   versioned send intent. Do not trust browser amounts, recipient or relationship
   IDs as the financial authority.
2. Persist provider customer/order/invoice/publish receipts and the CRM association
   durably before reporting success. A lost response/tab close currently can leave
   a published invoice outside CRM. Client send handling also needs to re-resolve
   the live estimate after hydration instead of mutating a detached old object.
3. Coordinate existing pending attempts before switching from old truncated keys
   to hashed keys. Retrying an earlier send under a new key can duplicate an invoice;
   a successful unit test of key uniqueness does not solve migration/retry recovery.
4. Replace the unconsumed webhook JSON file with a durable deduplicated inbox and
   transactionally reconciled payment records. Out-of-order events, restarts,
   refunds and unknown associations require explicit testing. The read-only polling
   changes do not implement this worker or ledger.

Do not push this entire branch to auto-deploying main until these financial and
the existing backup/authentication/migration gates are satisfied.

## Full repair release-candidate checkpoint (2026-09-21)

- The durable invoice intent, webhook inbox, server payment reconciliation, and
  atomic sales-number migrations are implemented locally. The browser no longer
  invents live lead, project, or estimate numbers; the database reserves them
  transactionally and preserves existing valid numbers.
- The payment migration rejects ambiguous legacy paid totals instead of silently
  dropping them, and browser sessions cannot rewrite provider-owned payment fields
  or move/delete linked payment history.
- The full local release gate passes: **776 executable tests**, **110 architecture
  checks**, JavaScript syntax checks, tracked whitespace checks, and the production
  dependency audit (zero reported vulnerabilities).
- This is a release candidate, not a live deployment. Production still requires a
  verified database backup, read-only numbering/payment preflight, the ordered SQL
  migrations, required server-only Render secrets, and post-migration authenticated
  admin/sales smoke tests before the compatible app may be merged to auto-deploying
  `main`.
- Browser dashboard inspection could not be completed on 2026-09-21 because the
  computer-control connection timed out twice. No production SQL or partial app
  deployment was attempted after that unknown state.

## Limited compatible release deployed (2026-09-15)

Following the user's explicit request to retry and deploy, a separate compatible
server/cache protection release was built from the previous live revision in an
isolated worktree. This is NOT deployment of the full audit repair package.

- GitHub main and both `jobcrestcrm.com` and `crm-6tg2.onrender.com` now serve
  **0d8b1761e500f25f9fad8bf36c80e384d013bf53**.
- Released files only: `server.js`, `sw.js`, `tests/server-release.test.js`.
  Static serving is allowlisted; private/runtime/diagnostic files are blocked;
  malformed URLs are handled; authentication defaults closed; public asset caches
  no longer intercept HTML, configuration or API/customer data. Cache quota failures
  retain fresh responses. Health reports the deployed revision.
- All existing CRM UI and Square invoice/payment handlers were retained from the
  prior production release. No database migration, customer-data change, invoice
  send, manual payment, credentials or provider configuration was part of this push.
- 49 focused tests plus release syntax checks passed. Live checks verified 11
  public files against the exact release, eight private paths returning 404,
  anonymous invoice/payment-status requests returning 401, expected headers and
  the exact deployed revision on both domains. These are HTTP tests, not a real
  browser sign-in or two-user save test. Chrome connection still timed out twice.
- Browser worker version: `jobcrest-crm-server-protection-20260915`. Existing users
  should reload to let the new worker activate. Server-side file protection does
  not depend on a browser reload.
- Larger audit package remains local, with 288 tests and 100 architecture checks
  passing. All previously documented payment/database/auth/backup gates still
  apply to that package. Nothing here certifies all audit findings repaired.

Git working-state caution: the original dirty audit workspace remains based on
`c8d4576`, while origin/main advanced to `0d8b176`. Its release marker and fresh
cache-response protection have been integrated locally. Preserve the dirty work;
base the future full release on the new origin/main and reconcile all three hotfix
files. Never force-push the old local main over the deployed release.
