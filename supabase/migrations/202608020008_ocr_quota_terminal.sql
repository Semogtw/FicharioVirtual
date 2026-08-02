create or replace function public.block_ocr_job_quota(
  target_page_id uuid,
  error_code text,
  blocked_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
begin
  if current_user_id is null or error_code !~ '^[a-z0-9_]{1,64}$' then return false; end if;

  select id into target_job_id
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
    and status = 'processing'
  for update;

  if not found then return false; end if;

  update public.ocr_jobs
  set status = 'blocked_quota',
      last_error_code = error_code,
      last_error_message = 'A cota diária do provedor foi atingida.',
      next_retry_at = null,
      finished_at = null
  where id = target_job_id;

  update public.pages
  set status = 'blocked_quota'
  where id = target_page_id and user_id = current_user_id;

  insert into public.usage_daily (
    user_id,
    usage_date,
    quota_errors,
    updated_at
  ) values (
    current_user_id,
    (blocked_at at time zone 'utc')::date,
    1,
    blocked_at
  )
  on conflict (user_id, usage_date) do update
  set quota_errors = public.usage_daily.quota_errors + 1,
      updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke execute on function public.block_ocr_job_quota(uuid, text, timestamptz) from public, anon;
grant execute on function public.block_ocr_job_quota(uuid, text, timestamptz) to authenticated;
