-- The table the website's "Request a quote" form writes to.
--
-- This table has been on the live project since 2026-10-20. It was made there
-- directly and its definition was never put in this repo, although a later
-- migration here (quote_request_import_status) already alters it. So a
-- database built from the repo had no such table: that migration was skipped,
-- and a backup's quote requests had nowhere to be restored to.
--
-- This file has the name and date of the migration recorded on the live
-- project, and it does nothing there: every step is skipped when the table
-- already exists. On a new database it makes the table as the live one is
-- today (read from the live project on 2026-11-23): the same columns, limits,
-- indexes, and the one rule that lets a visitor submit a request.
--
-- Not made here, on purpose: the trigger that tells the office about a new
-- request. It calls a web address with a secret in it, and a secret does not
-- belong in a file in the repo. On a rebuilt project it is set up again by hand
-- (Database > Webhooks), which is also where it was made.

do $$
begin
  if to_regclass('public.quote_requests') is not null then
    return;
  end if;

  create table public.quote_requests (
    id uuid not null default gen_random_uuid(),
    created_at timestamptz not null default now(),
    reference text not null,
    status text not null default 'new',
    segment text not null,
    division text not null,
    services text[] not null default '{}'::text[],
    urgency text not null,
    insurance_claim text,
    details jsonb not null default '{}'::jsonb,
    first_name text not null,
    last_name text not null,
    phone text not null,
    email text not null,
    company text,
    street text not null,
    city text not null,
    zip text not null,
    contact_pref text not null,
    best_time text,
    source text,
    consent boolean not null default false,
    photo_paths text[] not null default '{}'::text[],
    page_url text,
    user_agent text,
    office_notes text,
    constraint quote_requests_pkey primary key (id),
    constraint quote_requests_reference_key unique (reference),
    constraint quote_requests_reference_check check (reference ~ '^CC-[0-9]{6}-[0-9]{4}$'),
    constraint quote_requests_status_check check (status = any (array['new','imported','contacted','inspection_scheduled','proposal_sent','won','lost','spam'])),
    constraint quote_requests_segment_check check (segment = any (array['residential','commercial'])),
    constraint quote_requests_division_check check (division = any (array['roofing','construction','services'])),
    constraint quote_requests_urgency_check check (urgency = any (array['Emergency (active leak / damage)','Within 2 weeks','1–3 months','Just planning / budgeting'])),
    constraint quote_requests_insurance_claim_check check (insurance_claim = any (array['Yes','No','Not sure'])),
    constraint quote_requests_first_name_check check (char_length(first_name) >= 1 and char_length(first_name) <= 80),
    constraint quote_requests_last_name_check check (char_length(last_name) >= 1 and char_length(last_name) <= 80),
    constraint quote_requests_phone_check check (char_length(phone) >= 7 and char_length(phone) <= 30),
    constraint quote_requests_email_check check (char_length(email) >= 3 and char_length(email) <= 200),
    constraint quote_requests_company_check check (char_length(company) <= 200),
    constraint quote_requests_street_check check (char_length(street) <= 200),
    constraint quote_requests_city_check check (char_length(city) <= 100),
    constraint quote_requests_zip_check check (zip ~ '^\d{5}$'),
    constraint quote_requests_contact_pref_check check (contact_pref = any (array['Phone call','Text message','Email'])),
    constraint quote_requests_best_time_check check (best_time = any (array['Morning','Midday','Afternoon','Evening'])),
    constraint quote_requests_source_check check (source = any (array['Google search','Google Maps / reviews','Facebook / Instagram','Friend or neighbor','Yard sign / truck','Insurance adjuster','Repeat customer','Other'])),
    constraint quote_requests_page_url_check check (char_length(page_url) <= 2000),
    constraint quote_requests_user_agent_check check (char_length(user_agent) <= 300)
  );

  create index quote_requests_created_at_idx on public.quote_requests using btree (created_at desc);
  create index quote_requests_status_idx on public.quote_requests using btree (status);

  -- A visitor may hand in a request and nothing else: not read one, change one
  -- or remove one. The office reads them through the server.
  alter table public.quote_requests enable row level security;
  revoke all on table public.quote_requests from public, anon, authenticated;
  grant insert on table public.quote_requests to anon, authenticated;
  grant all on table public.quote_requests to service_role;

  create policy "Visitors can submit quote requests"
  on public.quote_requests for insert to anon, authenticated
  with check (
    status = 'new'
    and consent = true
    and office_notes is null
    and cardinality(services) between 1 and 20
    and cardinality(photo_paths) <= 10
    and pg_column_size(details) < 20000
  );
end;
$$;
