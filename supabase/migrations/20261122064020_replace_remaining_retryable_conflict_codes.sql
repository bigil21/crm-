-- PostgREST 14 retries SQLSTATE 40001 because it means serialization_failure.
-- These are application conflicts, not transient transaction failures, so map
-- them to one HTTP 409 response instead. The migration rewrites only the seven
-- known RPC functions and is safe to replay.
do $migration$
declare
  signature text;
  proc regprocedure;
  original text;
  def text;
begin
  foreach signature in array array[
    'public.crm_square_begin_invoice(text,uuid,text,integer,text)',
    'public.crm_square_checkpoint_invoice(text,uuid,text,jsonb)',
    'public.crm_square_complete_invoice(text,uuid,jsonb)',
    'public.crm_square_fail_webhook(text,text,text,text,uuid,text,boolean)',
    'public.crm_square_apply_payment(text,text,text,text,uuid,jsonb)',
    'public.crm_square_enqueue_webhook(text,text,jsonb)',
    'public.crm_ingest_website_request(text,text,text,text,text,uuid,jsonb)'
  ] loop
    proc := to_regprocedure(signature);
    continue when proc is null;
    original := pg_get_functiondef(proc);
    def := regexp_replace(
      original,
      $re$errcode\s*=\s*'40001'$re$,
      $replacement$errcode='PT409'$replacement$,
      'gi'
    );
    if def ~* $re$errcode\s*=\s*'40001'$re$ then
      raise exception '% still raises an application conflict with 40001', signature;
    end if;
    if def is distinct from original then
      execute def;
    end if;
  end loop;
end
$migration$;
