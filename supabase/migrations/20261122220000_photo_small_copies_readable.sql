-- A job photo's small gallery copy (to-do item 9) is a stored file of its own,
-- kept beside the original as <same folder>/preview.jpg and named on the
-- photo's record as previewPath.
--
-- Managers can read every stored file. Anyone else can read a stored file only
-- when a record they own names it as storagePath (or as an earlier version of
-- it). Without this change such a person - a sales rep on their own lead -
-- could store the small copy but was refused when the gallery asked for it.
--
-- This lets the same person read the small copy of that same record, and only
-- when it sits in the same folder as the record's own file. Who may read an
-- original, and who may store anything, is unchanged. Safe to apply twice.
begin;

drop policy if exists "Approved CRM users read company document objects" on storage.objects;
create policy "Approved CRM users read company document objects"
on storage.objects for select to authenticated
using (
  bucket_id='crm-documents'
  and public.is_coastal_crest_user()
  and (storage.foldername(name))[1]=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or (storage.foldername(name))[2]='company'
    or exists (
      select 1 from public.crm_records r
      where r.company_state_id=public.crm_base_state_id()
        and r.record_type='document' and r.owner_id=(select auth.uid()) and r.deleted_at is null
        and (
          r.data->>'storagePath'=storage.objects.name
          or (
            r.data->>'previewPath'=storage.objects.name
            and storage.foldername(r.data->>'previewPath')=storage.foldername(r.data->>'storagePath')
          )
          or exists (
            select 1 from jsonb_array_elements(coalesce(r.data->'previousVersions','[]'::jsonb)) as version_item(value)
            where version_item.value->>'storagePath'=storage.objects.name
          )
        )
    )
  )
);

commit;
