create or replace function public.list_resumable_ocr_pages(
  target_document_id uuid,
  selection_at timestamptz default timezone('utc', now())
)
returns table (
  page_id uuid,
  page_number integer
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
    or not (select public.is_authorized_user())
  then
    return;
  end if;

  perform public.recover_stale_ocr_jobs();

  return query
  select p.id, p.page_number
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.document_id = target_document_id
    and p.user_id = current_user_id
    and d.user_id = current_user_id
    and p.status in ('pending', 'retryable', 'blocked_quota')
    and exists (
      select 1
      from public.ocr_jobs j
      where j.page_id = p.id
        and j.user_id = current_user_id
        and j.status in ('pending', 'retryable', 'blocked_quota')
        and (j.next_retry_at is null or j.next_retry_at <= selection_at)
    )
  order by p.page_number, p.id;
end;
$$;

revoke execute on function public.list_resumable_ocr_pages(uuid, timestamptz) from public, anon;
grant execute on function public.list_resumable_ocr_pages(uuid, timestamptz) to authenticated;
