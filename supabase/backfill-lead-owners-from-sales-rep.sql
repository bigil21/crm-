-- One-time repair: give each lead to the team member named as its Sales Rep.
--
-- Why: since 20261022145711 a rep can only see rows they own (owner_id), but
-- older leads were owned by whoever first synced them, not by their Sales Rep.
-- Run AFTER 20261022180000_sales_rep_assignment_and_stage_corrections.sql.
--
-- How to use (Supabase SQL Editor):
--   1. Run STEP 1 alone and review the preview. Only Sales Rep names that match
--      exactly one approved CRM user's name (Auth user metadata "name" or
--      "full_name") or email are reassigned; everything else is listed as
--      unmatched so you can fix the name or the user's profile first.
--   2. Run STEP 2. It updates the lead and its jobs, estimates and documents,
--      plus tasks that belonged to the previous owner, and bumps each row's
--      version so open browsers reload instead of overwriting the change.

-- STEP 1: preview -------------------------------------------------------------
with team as (
  select a.user_id, a.email,
    lower(coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(a.email,'@',1))) as name_key,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(a.email,'@',1)) as name
  from public.crm_user_access a join auth.users u on u.id = a.user_id
  where a.approved and a.role <> 'viewer'
),
leads as (
  select r.id, r.owner_id, trim(coalesce(r.data->>'salesRep','')) as sales_rep, r.data->>'name' as lead_name
  from public.crm_records r
  where r.company_state_id = public.crm_base_state_id() and r.record_type = 'contact' and r.deleted_at is null
)
select l.lead_name, l.sales_rep,
  case when count(t.user_id) = 1 then max(t.name) when count(t.user_id) > 1 then 'AMBIGUOUS NAME' else 'UNMATCHED' end as new_owner,
  case when count(t.user_id) = 1 and (array_agg(t.user_id))[1] is distinct from l.owner_id then 'will change' else 'no change' end as action
from leads l
left join team t on t.name_key = lower(l.sales_rep) or t.email = lower(l.sales_rep)
group by l.id, l.lead_name, l.sales_rep, l.owner_id
order by action desc, new_owner, l.lead_name;

-- STEP 2: apply ---------------------------------------------------------------
begin;

create temporary table lead_owner_fix on commit drop as
with team as (
  select a.user_id, a.email,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(a.email,'@',1)) as name
  from public.crm_user_access a join auth.users u on u.id = a.user_id
  where a.approved and a.role <> 'viewer'
),
matches as (
  select r.id as lead_id, r.owner_id as old_owner, t.user_id, t.email, t.name,
    count(*) over (partition by r.id) as candidates
  from public.crm_records r
  join team t on lower(t.name) = lower(trim(coalesce(r.data->>'salesRep','')))
    or t.email = lower(trim(coalesce(r.data->>'salesRep','')))
  where r.company_state_id = public.crm_base_state_id() and r.record_type = 'contact' and r.deleted_at is null
)
select lead_id, old_owner, user_id as new_owner, email as new_email, name as new_name
from matches where candidates = 1 and user_id is distinct from old_owner;

update public.crm_records r
set owner_id = f.new_owner,
    data = r.data || jsonb_build_object('ownerUserId', f.new_owner, 'ownerEmail', f.new_email, 'ownerName', f.new_name),
    version = r.version + 1,
    updated_at = now()
from lead_owner_fix f
where r.company_state_id = public.crm_base_state_id()
  and r.lead_id = f.lead_id
  and (
    r.record_type in ('contact', 'job', 'estimate', 'document')
    or (r.record_type = 'task' and (r.owner_id = f.old_owner or r.owner_id is null))
  );

select count(*) as leads_reassigned from lead_owner_fix;

commit;
