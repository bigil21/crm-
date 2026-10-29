begin;

alter table public.quote_requests drop constraint if exists quote_requests_status_check;
alter table public.quote_requests add constraint quote_requests_status_check
  check (status = any (array[
    'new'::text,
    'imported'::text,
    'contacted'::text,
    'inspection_scheduled'::text,
    'proposal_sent'::text,
    'won'::text,
    'lost'::text,
    'spam'::text
  ]));

commit;
