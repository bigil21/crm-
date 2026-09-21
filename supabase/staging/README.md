# Isolated authenticated staging

This directory is **not** a production migration batch. It configures the approved
sales tester in the separate Supabase project `ixksmfiektzsunmmwejz` only.

The two SQL files are templates. They contain `__STAGING_TEST_USER_ID__` and
`__STAGING_TEST_EMAIL__`, not personal identifiers. Substitute the approved exact
identity only in a private, Git-ignored local copy after the access checkpoint.
Never commit that rendered copy or credentials. Tests render synthetic fixture
values in memory; they do not use the real tester's account or password.

## Access boundary

- Production still accepts the company domain only. No broad Gmail allowance.
- The staging database exception requires the exact approved user ID/email,
  `app_metadata.role = sales`, and the exact test-project JWT issuer. The issuer
  format follows [Supabase's JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields).
- `approved-sales-tester.sql` refuses to run if that confirmed account does not
  exist or is in the CRM admin list. It preserves other application metadata.
- Apply `../migrations/20260914_company_settings_permissions.sql` before granting
  this exception. Sales can read company settings but cannot alter them. Ordinary
  record editing uses the already-installed versioned commit function.
- The current app additionally requires `../migrations/20260914_versioned_company_settings.sql`.
  This third migration is currently LOCAL ONLY; apply/verify it in staging before
  testing the current client. Do not mistake the earlier hosted checkpoint for
  installation of this later migration.
- `approved-sales-smoke.sql` tests ordinary cents/checklist editing, blocked
  payment/settings writes, and wrong-project denial. It rolls back its synthetic
  records, audit events and receipts. This is SQL role simulation, not a real
  hosted Auth browser sign-in.

## Local launch

`node scripts/start-staging.js` reads only `.env.staging.local` (ignored by Git),
uses the existing test-project **publishable** key, and starts on loopback port
4176. The launcher removes inherited Supabase, Square and CRM auth configuration.
It never reads `.env` or `.env.local`, never permits demo auth bypass, and never
uses a service key. Invalid staging flags/project/identity/Square credentials
stop startup instead of silently enabling another environment.

Required ignored local settings: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the
`sb_publishable_...` key), `CRM_STAGING_TEST_EMAIL`, `CRM_STAGING_TEST_USER_ID`.
Do not put passwords, service-role credentials or Square tokens in this file.

The cloud-disabled demo remains at port 4175. The authenticated staging login is
`http://127.0.0.1:4176/login`; its banner explicitly identifies the isolated test.
Users enter their own passwords. No password, token minting or impersonation
shortcut may stand in for real admin/sales sign-in verification.

## Hosted checkpoint, 2026-09-14

Approved sales identity role assigned and company-settings restrictive policies
installed. Smoke passed; separate post-test check returned PostgreSQL role
`postgres` and **0 records, 0 events, 0 receipts**. The normalized installed
`is_coastal_crest_user` body matched the approved privately rendered source: MD5
`c04ded0feb71f7a16bed54491f31dd71` (source-comparison fingerprint, not a security hash).

Browser login page loads and the authenticated local payment API rejects anonymous
requests. Hosted anonymous record listing responds under RLS; an empty response
in an empty database does not certify protection of populated records. Real user
sign-in, cross-browser save/readback, authenticated Storage upload/download,
and remaining production-readiness checks are still pending.

### SQL editor caution

The browser's generic `setValue` must not be used to replace Monaco editor text:
it can leave earlier content in place. Focus the editor, select all, paste the
complete query, then inspect its beginning/end before Run. After role-simulation
tests, use a separate `rollback; reset role;` before read-only administrative
verification. Do not follow error hints to grant sales access to private receipts.
