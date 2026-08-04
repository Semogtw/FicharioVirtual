create or replace function public.list_runnable_ocr_jobs(
  selection_at timestamptz default timezone('utc', now()),
  result_limit integer default 50
)
returns table (
  page_id uuid,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null
    or selection_at is null
    or result_limit < 1
    or result_limit > 100
    or not (select public.is_authorized_user())
  then
    return;
  end if;

  return query
  select
    j.page_id,
    j.attempt_count
  from public.ocr_jobs j
  join public.pages p
    on p.id = j.page_id
    and p.user_id = j.user_id
  where j.user_id = current_user_id
    and p.user_id = current_user_id
    and j.status in ('pending', 'retryable', 'blocked_quota')
    and p.status in ('pending', 'retryable', 'blocked_quota')
    and j.attempt_count < 3
    and (j.next_retry_at is null or j.next_retry_at <= selection_at)
  order by
    coalesce(j.next_retry_at, j.created_at),
    j.created_at,
    j.id
  limit result_limit;
end;
$$;

revoke execute on function public.list_runnable_ocr_jobs(timestamptz, integer) from public, anon;
grant execute on function public.list_runnable_ocr_jobs(timestamptz, integer) to authenticated;
