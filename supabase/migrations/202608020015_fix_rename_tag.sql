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
    or requested_normalized_name ~ '[\u0000-\u001f\u007f]'
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
