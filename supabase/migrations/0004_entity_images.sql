-- Add image_url to visual entity tables
alter table public.people    add column if not exists image_url text;
alter table public.locations add column if not exists image_url text;
alter table public.factions  add column if not exists image_url text;
alter table public.items     add column if not exists image_url text;

-- Public bucket for entity images
insert into storage.buckets (id, name, public)
values ('entity-images', 'entity-images', true)
on conflict (id) do nothing;

-- Storage RLS: anyone reads, authenticated writes (mirrors 0003_enable_writes.sql)
create policy "anon read entity-images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'entity-images');

create policy "auth write entity-images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'entity-images');

create policy "auth update entity-images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'entity-images');

create policy "auth delete entity-images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'entity-images');
