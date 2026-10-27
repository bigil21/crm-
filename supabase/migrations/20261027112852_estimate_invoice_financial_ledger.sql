-- Estimate-to-invoice and financial ledger foundation.
-- Monetary values use fixed-precision numeric columns; browser roles receive
-- explicit Data API grants and every exposed table is protected by RLS.

create table if not exists public.crm_invoices (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  invoice_number text not null,
  lead_id text not null,
  job_id text not null,
  estimate_id text not null default '',
  status text not null default 'draft' check (status in ('draft','sent','partial','paid','overdue','void')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  issue_date date not null,
  due_date date,
  terms text not null default '',
  notes text not null default '',
  provider text not null default 'internal' check (provider in ('internal','square','zoho')),
  provider_invoice_id text not null default '',
  provider_url text not null default '',
  owner_user_id uuid,
  owner_email text not null default '',
  owner_name text not null default '',
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id),
  unique (company_state_id, invoice_number),
  check (due_date is null or due_date >= issue_date),
  check (amount_paid <= total_amount or status in ('paid','void'))
);

create table if not exists public.crm_invoice_items (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  amount numeric(14,2) not null check (amount >= 0),
  position integer not null default 0 check (position >= 0),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id),
  foreign key (company_state_id, invoice_id)
    references public.crm_invoices(company_state_id, id) on delete restrict
);

create table if not exists public.crm_payments (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  lead_id text not null,
  job_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method text not null,
  reference text not null default '',
  note text not null default '',
  provider text not null default 'manual' check (provider in ('manual','square','bank','financing','other')),
  provider_payment_id text not null default '',
  received_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id)
);

create table if not exists public.crm_payment_allocations (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  payment_id text not null,
  invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id),
  foreign key (company_state_id, payment_id)
    references public.crm_payments(company_state_id, id) on delete restrict,
  foreign key (company_state_id, invoice_id)
    references public.crm_invoices(company_state_id, id) on delete restrict
);

create table if not exists public.crm_expenses (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  lead_id text not null,
  job_id text not null,
  category text not null,
  vendor text not null default '',
  description text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null,
  reference text not null default '',
  status text not null default 'recorded' check (status in ('recorded','approved','paid','void')),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id)
);

create table if not exists public.crm_credit_notes (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  credit_number text not null,
  invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'draft' check (status in ('draft','applied','void')),
  issued_at date not null,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, id),
  unique (company_state_id, credit_number),
  foreign key (company_state_id, invoice_id)
    references public.crm_invoices(company_state_id, id) on delete restrict
);

create index if not exists crm_invoices_lead_job_status_idx
  on public.crm_invoices(company_state_id, lead_id, job_id, status, issue_date desc);
create index if not exists crm_invoices_estimate_idx
  on public.crm_invoices(company_state_id, estimate_id) where estimate_id <> '';
create unique index if not exists crm_invoices_provider_unique_idx
  on public.crm_invoices(company_state_id, provider, provider_invoice_id) where provider_invoice_id <> '';
create index if not exists crm_invoice_items_invoice_position_idx
  on public.crm_invoice_items(company_state_id, invoice_id, position);
create index if not exists crm_payments_job_received_idx
  on public.crm_payments(company_state_id, lead_id, job_id, received_at desc);
create unique index if not exists crm_payments_provider_unique_idx
  on public.crm_payments(company_state_id, provider, provider_payment_id) where provider_payment_id <> '';
create index if not exists crm_payment_allocations_invoice_idx
  on public.crm_payment_allocations(company_state_id, invoice_id);
create index if not exists crm_payment_allocations_payment_idx
  on public.crm_payment_allocations(company_state_id, payment_id);
create index if not exists crm_expenses_job_date_idx
  on public.crm_expenses(company_state_id, lead_id, job_id, expense_date desc);
create index if not exists crm_credit_notes_invoice_idx
  on public.crm_credit_notes(company_state_id, invoice_id, issued_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_invoices', 'crm_invoice_items', 'crm_payments',
    'crm_payment_allocations', 'crm_expenses', 'crm_credit_notes'
  ] loop
    execute format('drop trigger if exists crm_stamp_financial_row on public.%I', table_name);
    execute format(
      'create trigger crm_stamp_financial_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',
      table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "CRM financial rows are visible in scope" on public.%I', table_name);
    execute format('drop policy if exists "CRM admins create financial rows" on public.%I', table_name);
    execute format('drop policy if exists "CRM admins update financial rows" on public.%I', table_name);
    execute format(
      'create policy "CRM financial rows are visible in scope" on public.%I for select to authenticated using (public.crm_workflow_row_access(company_state_id, lead_id, created_by))',
      table_name
    );
    execute format(
      'create policy "CRM admins create financial rows" on public.%I for insert to authenticated with check (public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()))',
      table_name
    );
    execute format(
      'create policy "CRM admins update financial rows" on public.%I for update to authenticated using (public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check (public.is_crm_admin() and company_state_id=public.crm_base_state_id())',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to authenticated', table_name);
  end loop;
end;
$$;

-- Confirmed payments and allocations are append-only. Corrections are made by
-- an explicit adjustment or credit rather than rewriting financial history.
revoke update on public.crm_payments, public.crm_payment_allocations from authenticated;

create or replace function public.crm_create_invoice_from_estimate(p_invoice jsonb, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  company_id text := public.crm_base_state_id();
  estimate_row public.crm_records%rowtype;
  job_row public.crm_records%rowtype;
  item jsonb;
  item_sum numeric(14,2) := 0;
  invoice_id text := coalesce(p_invoice->>'id','');
  estimate_id text := coalesce(p_invoice->>'estimate_id','');
  invoice_lead_id text := coalesce(p_invoice->>'lead_id','');
  invoice_job_id text := coalesce(p_invoice->>'job_id','');
  invoice_total numeric(14,2);
  invoice_subtotal numeric(14,2);
  invoice_tax numeric(14,2);
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or estimate_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or coalesce(p_invoice->>'invoice_number','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
    or invoice_lead_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or invoice_job_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
  then raise exception 'invalid_invoice_payload'; end if;

  select * into estimate_row
  from public.crm_records
  where company_state_id=company_id and record_type='estimate' and id=estimate_id and deleted_at is null;
  if not found
    or estimate_row.lead_id is distinct from invoice_lead_id
    or estimate_row.job_id is distinct from invoice_job_id
    or coalesce(estimate_row.data->>'status','') <> 'Won'
  then raise exception 'won_estimate_required'; end if;

  select * into job_row
  from public.crm_records r
  where r.company_state_id=company_id and r.record_type='job' and r.id=invoice_job_id
    and r.lead_id=invoice_lead_id and r.deleted_at is null;
  if not found or coalesce(job_row.data->>'status','') <> 'Won'
  then raise exception 'won_job_required'; end if;

  invoice_subtotal := round((p_invoice->>'subtotal')::numeric, 2);
  invoice_tax := round((p_invoice->>'tax_amount')::numeric, 2);
  invoice_total := round((p_invoice->>'total_amount')::numeric, 2);
  if invoice_subtotal < 0 or invoice_tax < 0 or invoice_total <> invoice_subtotal + invoice_tax
  then raise exception 'invalid_invoice_totals'; end if;

  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce(item->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
      or char_length(btrim(coalesce(item->>'description',''))) not between 1 and 2000
      or (item->>'quantity')::numeric <= 0
      or (item->>'unit_price')::numeric < 0
      or round((item->>'amount')::numeric,2) <> round((item->>'quantity')::numeric * (item->>'unit_price')::numeric,2)
    then raise exception 'invalid_invoice_item'; end if;
    item_sum := item_sum + round((item->>'amount')::numeric,2);
  end loop;
  if item_sum <> invoice_subtotal then raise exception 'invoice_item_total_mismatch'; end if;

  insert into public.crm_invoices(
    company_state_id,id,invoice_number,lead_id,job_id,estimate_id,status,currency,
    subtotal,tax_amount,total_amount,amount_paid,issue_date,due_date,terms,notes,
    provider,owner_user_id,owner_email,owner_name,created_by,updated_by
  ) values (
    company_id,invoice_id,p_invoice->>'invoice_number',invoice_lead_id,invoice_job_id,estimate_id,'draft','USD',
    invoice_subtotal,invoice_tax,invoice_total,0,(p_invoice->>'issue_date')::date,
    nullif(p_invoice->>'due_date','')::date,coalesce(p_invoice->>'terms',''),coalesce(p_invoice->>'notes',''),
    'internal',estimate_row.owner_id,coalesce(estimate_row.data->>'ownerEmail',''),
    coalesce(estimate_row.data->>'ownerName',''),auth.uid(),auth.uid()
  );

  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.crm_invoice_items(
      company_state_id,id,invoice_id,lead_id,job_id,description,quantity,unit_price,amount,position,created_by,updated_by
    ) values (
      company_id,item->>'id',invoice_id,invoice_lead_id,invoice_job_id,item->>'description',
      (item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'amount')::numeric,
      coalesce((item->>'position')::integer,0),auth.uid(),auth.uid()
    );
  end loop;

  return jsonb_build_object('id',invoice_id,'invoice_number',p_invoice->>'invoice_number','status','draft');
exception
  when unique_violation then raise exception 'invoice_already_exists';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'invalid_invoice_payload';
end;
$$;
revoke all on function public.crm_create_invoice_from_estimate(jsonb,jsonb) from public, anon;
grant execute on function public.crm_create_invoice_from_estimate(jsonb,jsonb) to authenticated;
