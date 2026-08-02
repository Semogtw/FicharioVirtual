create or replace function public.create_tag(tag_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_name text := trim(tag_name);
  requested_normalized_name text := lower(trim(tag_name));
  created_id uuid;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(requested_name) not between 1 and 120
    or requested_name ~ '[[:cntrl:]]'
  then
    raise exception 'invalid tag name' using errcode = '22023';
  end if;

  insert into public.tags (user_id, name, normalized_name)
  values (current_user_id, requested_name, requested_normalized_name)
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
  requested_name text := trim(tag_name);
  requested_normalized_name text := lower(trim(tag_name));
  changed_rows integer;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then return false; end if;
  if char_length(requested_name) not between 1 and 120
    or requested_name ~ '[[:cntrl:]]'
  then
    return false;
  end if;

  update public.tags
  set name = requested_name,
      normalized_name = requested_normalized_name,
      updated_at = timezone('utc', now())
  where id = target_tag_id
    and user_id = current_user_id;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
exception when unique_violation then
  return false;
end;
$$;
