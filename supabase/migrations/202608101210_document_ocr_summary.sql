create or replace function public.get_document_ocr_summary(target_document_id uuid)
returns table (
  total integer,
  completed integer,
  needs_review integer,
  pending integer,
  failed integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if target_document_id is null or not exists (
    select 1
    from public.documents
    where id = target_document_id
      and user_id = current_user_id
  ) then
    raise exception using errcode = '22023', message = 'Invalid document';
  end if;

  return query
  select
    count(*)::integer as total,
    count(*) filter (
      where page.status = 'ready'::public.page_status
        and job.status = 'ready'::public.ocr_status
    )::integer as completed,
    count(*) filter (
      where page.status = 'needs_review'::public.page_status
        and job.status in ('ready'::public.ocr_status, 'needs_review'::public.ocr_status)
    )::integer as needs_review,
    count(*) filter (
      where page.status not in (
        'ready'::public.page_status,
        'needs_review'::public.page_status,
        'failed'::public.page_status
      )
        and job.status <> 'failed'::public.ocr_status
    )::integer as pending,
    count(*) filter (
      where page.status = 'failed'::public.page_status
         or job.status = 'failed'::public.ocr_status
    )::integer as failed
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  where job.user_id = current_user_id
    and page.document_id = target_document_id;
end;
$$;

revoke execute on function public.get_document_ocr_summary(uuid) from public, anon;
grant execute on function public.get_document_ocr_summary(uuid) to authenticated, service_role;
