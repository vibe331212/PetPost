-- Uploading (and replacing) a file needs permission to look up files in the bucket.
create policy "members can look up media" on storage.objects for select to authenticated
  using (bucket_id = 'media');
