create or replace function public.is_authorized_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.app_users
      where user_id = (select auth.uid())
        and is_active = true
    );
$$;

revoke execute on function public.is_authorized_user() from public, anon;
grant execute on function public.is_authorized_user() to authenticated;

alter table public.app_users enable row level security;
alter table public.app_users force row level security;
alter table public.notebooks enable row level security;
alter table public.notebooks force row level security;
alter table public.documents enable row level security;
alter table public.documents force row level security;
alter table public.pages enable row level security;
alter table public.pages force row level security;
alter table public.ocr_jobs enable row level security;
alter table public.ocr_jobs force row level security;
alter table public.tags enable row level security;
alter table public.tags force row level security;
alter table public.document_tags enable row level security;
alter table public.document_tags force row level security;
alter table public.import_sessions enable row level security;
alter table public.import_sessions force row level security;
alter table public.usage_daily enable row level security;
alter table public.usage_daily force row level security;

create policy app_users_select_self
on public.app_users
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notebooks_owner_all
on public.notebooks
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy documents_owner_all
on public.documents
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy pages_owner_all
on public.pages
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy ocr_jobs_owner_all
on public.ocr_jobs
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy tags_owner_all
on public.tags
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy document_tags_owner_all
on public.document_tags
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy import_sessions_owner_all
on public.import_sessions
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy usage_daily_owner_select
on public.usage_daily
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

revoke all on table public.app_users from anon;
revoke all on table public.notebooks from anon;
revoke all on table public.documents from anon;
revoke all on table public.pages from anon;
revoke all on table public.ocr_jobs from anon;
revoke all on table public.tags from anon;
revoke all on table public.document_tags from anon;
revoke all on table public.import_sessions from anon;
revoke all on table public.usage_daily from anon;

revoke all on table public.app_users from authenticated;
grant select on table public.app_users to authenticated;

grant select, insert, update, delete on table public.notebooks to authenticated;
grant select, insert, update, delete on table public.documents to authenticated;
grant select, insert, update, delete on table public.pages to authenticated;
grant select, insert, update, delete on table public.ocr_jobs to authenticated;
grant select, insert, update, delete on table public.tags to authenticated;
grant select, insert, update, delete on table public.document_tags to authenticated;
grant select, insert, update, delete on table public.import_sessions to authenticated;

grant select on table public.usage_daily to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy document_objects_owner_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_authorized_user())
);

create policy document_objects_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_authorized_user())
);

create policy document_objects_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_authorized_user())
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_authorized_user())
);

create policy document_objects_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_authorized_user())
);
