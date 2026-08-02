create or replace function public.list_tags()
returns table (
  tag_id uuid,
  name text,
  document_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id,
    t.name,
    count(dt.document_id) as document_count,
    t.created_at,
    t.updated_at
  from public.tags t
  left join public.document_tags dt
    on dt.tag_id = t.id
    and dt.user_id = t.user_id
  where t.user_id = (select auth.uid())
    and (select public.is_authorized_user())
  group by t.id, t.name, t.created_at, t.updated_at
  order by lower(t.name), t.id;
$$;

create or replace function public.create_tag(tag_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_name text := lower(trim(tag_name));
  created_id uuid;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(trim(tag_name)) not between 1 and 120
    or normalized_name ~ '[\u0000-\u001f\u007f]'
  then
    raise exception 'invalid tag name' using errcode = '22023';
  end if;

  insert into public.tags (user_id, name, normalized_name)
  values (current_user_id, trim(tag_name), normalized_name)
  on conflict (user_id, normalized_name) do update
  set name = excluded.name,
      updated_at = timezone('utc', now())
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.rename_tag(target_tag_id uuid, tag_name text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_name text := lower(trim(tag_name));
  changed_rows integer;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then return false; end if;
  if char_length(trim(tag_name)) not between 1 and 120
    or normalized_name ~ '[\u0000-\u001f\u007f]'
  then
    return false;
  end if;

  update public.tags
  set name = trim(tag_name),
      normalized_name = normalized_name,
      updated_at = timezone('utc', now())
  where id = target_tag_id
    and user_id = current_user_id;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.delete_tag(target_tag_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then return false; end if;

  delete from public.tags
  where id = target_tag_id
    and user_id = current_user_id;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create or replace function public.list_tag_document_ids(target_tag_id uuid)
returns table (document_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select dt.document_id
  from public.document_tags dt
  join public.tags t
    on t.id = dt.tag_id
    and t.user_id = dt.user_id
  join public.documents d
    on d.id = dt.document_id
    and d.user_id = dt.user_id
  where dt.tag_id = target_tag_id
    and dt.user_id = (select auth.uid())
    and (select public.is_authorized_user())
  order by dt.document_id;
$$;

create or replace function public.set_tag_membership(
  target_tag_id uuid,
  target_document_id uuid,
  assigned boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not (select public.is_authorized_user()) then return false; end if;
  if not exists (
    select 1 from public.tags
    where id = target_tag_id and user_id = current_user_id
  ) or not exists (
    select 1 from public.documents
    where id = target_document_id and user_id = current_user_id
  ) then
    return false;
  end if;

  if assigned then
    insert into public.document_tags (user_id, document_id, tag_id)
    values (current_user_id, target_document_id, target_tag_id)
    on conflict do nothing;
  else
    delete from public.document_tags
    where user_id = current_user_id
      and document_id = target_document_id
      and tag_id = target_tag_id;
  end if;

  update public.tags
  set updated_at = timezone('utc', now())
  where id = target_tag_id and user_id = current_user_id;

  return true;
end;
$$;

revoke execute on function public.list_tags() from public, anon;
grant execute on function public.list_tags() to authenticated;
revoke execute on function public.create_tag(text) from public, anon;
grant execute on function public.create_tag(text) to authenticated;
revoke execute on function public.rename_tag(uuid, text) from public, anon;
grant execute on function public.rename_tag(uuid, text) to authenticated;
revoke execute on function public.delete_tag(uuid) from public, anon;
grant execute on function public.delete_tag(uuid) to authenticated;
revoke execute on function public.list_tag_document_ids(uuid) from public, anon;
grant execute on function public.list_tag_document_ids(uuid) to authenticated;
revoke execute on function public.set_tag_membership(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_tag_membership(uuid, uuid, boolean) to authenticated;
