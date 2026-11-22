-- Save conflicts must not use SQLSTATE 40001 (serialization_failure).
--
-- PostgREST retries any transaction that fails with 40001, with no limit. The
-- record and settings writers raised their version conflicts with that code,
-- so every conflicting save looped inside the API layer forever and held one
-- pool connection for good. On 2026-11-22 the pool ran out: every request
-- timed out (PGRST003) and sign-in reported "not approved for CRM access".
--
-- Conflicts are now raised with PT409: PostgREST answers HTTP 409 once and
-- does not retry. The settings conflict also carries a detail containing
-- "record_conflict" so clients released before PT409 was recognised still
-- treat it as a conflict and merge.
--
-- Applied to production on 2026-11-22 as version 20261122061845 (same
-- replacements, against crm_commit_records_authorized_legacy and
-- crm_commit_company_settings). This file also covers a database where the
-- record writer still has its original name, and is safe to re-run.
--
-- Rollback: not recommended. Reversing the replacements restores the outage.
do $migration$
declare
  signature text;
  proc regprocedure;
  original text;
  def text;
begin
  foreach signature in array array[
    'public.crm_commit_records_authorized_legacy(text,jsonb,jsonb)',
    'public.crm_commit_records(text,jsonb,jsonb)',
    'public.crm_commit_company_settings(text,integer,jsonb)'
  ] loop
    proc := to_regprocedure(signature);
    continue when proc is null;
    original := pg_get_functiondef(proc);
    def := original;
    def := replace(def, $a$'record_conflict' using errcode = '40001'$a$,      $a$'record_conflict' using errcode = 'PT409'$a$);
    def := replace(def, $a$'record_conflict' using errcode='40001'$a$,        $a$'record_conflict' using errcode='PT409'$a$);
    def := replace(def, $a$'audit_event_conflict' using errcode = '40001'$a$, $a$'audit_event_conflict' using errcode = 'PT409'$a$);
    def := replace(def,
      $a$raise exception 'settings_conflict' using errcode = '40001';$a$,
      $a$raise exception 'settings_conflict' using errcode = 'PT409', detail = 'record_conflict: company settings changed since they were loaded';$a$);
    if def ~ $re$_conflict' using errcode\s*=\s*'40001'$re$ then
      raise exception '% still raises a save conflict with 40001', signature;
    end if;
    if def is distinct from original then
      execute def;
    end if;
  end loop;
end
$migration$;
