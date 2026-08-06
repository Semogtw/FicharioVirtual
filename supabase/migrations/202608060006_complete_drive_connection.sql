create or replace function public.complete_drive_connection(
  target_user_id uuid,
  target_root_folder_id text,
  target_start_page_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if target_user_id is null
    or target_root_folder_id is null
    or char_length(target_root_folder_id) not between 10 and 256
    or target_root_folder_id !~ '^[A-Za-z0-9_-]+$'
    or target_start_page_token is null
    or char_length(target_start_page_token) not between 1 and 4096
    or target_start_page_token ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'Invalid Drive bootstrap result';
  end if;

  if not exists (
    select 1
    from private.drive_credentials as credential
    join public.app_users as app_user
      on app_user.user_id = credential.user_id
     and app_user.is_active
    where credential.user_id = target_user_id
  ) then
    raise insufficient_privilege using message = 'Drive credential is not authorized';
  end if;

  update public.drive_connections as connection
  set
    status = 'connected',
    root_folder_id = target_root_folder_id,
    start_page_token = target_start_page_token,
    next_page_token = null,
    last_error_code = null,
    last_error_message = null
  where connection.user_id = target_user_id;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke execute on function public.complete_drive_connection(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_drive_connection(uuid, text, text)
  to service_role;
