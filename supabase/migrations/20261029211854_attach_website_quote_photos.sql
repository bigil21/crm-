-- Where the photos go that a visitor attaches to a website quote request.
--
-- Like the quote requests table, this has been on the live project since
-- 2026-10-29 and was never in this repo. This file has the name and date of the
-- migration recorded there, and changes nothing there: the folder ("bucket")
-- and its one rule are made only where they do not exist yet. A request names
-- its photos in quote_requests.photo_paths; the files are in this bucket.
--
-- The bucket is private. A visitor may put a photo in it, inside a folder named
-- with a random id, and may not read, replace or remove anything.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-photos', 'quote-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Visitors can upload quote photos'
  ) then
    create policy "Visitors can upload quote photos"
    on storage.objects for insert to anon, authenticated
    with check (
      bucket_id = 'quote-photos'
      and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
  end if;
end;
$$;
