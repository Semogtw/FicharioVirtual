create or replace function public.recover_stale_ocr_jobs()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  recovered_page_ids uuid[];
  recovered_count integer := 0;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then return 0; end if;

  with recovered as (
    update public.ocr_jobs
    set status = 'retryable',
        last_error_code = 'stale_processing_claim',
        last_error_message = 'O processamento anterior foi interrompido e pode ser retomado.',
        next_retry_at = timezone('utc', now()),
        started_at = null,
        finished_at = null
    where user_id = current_user_id
      and status = 'processing'
      and started_at is not null
      and started_at <= timezone('utc', now()) - interval '15 minutes'
    returning page_id
  )
  select coalesce(array_agg(page_id), '{}'::uuid[])
  into recovered_page_ids
  from recovered;

  recovered_count := cardinality(recovered_page_ids);
  if recovered_count > 0 then
    update public.pages
    set status = 'retryable'
    where user_id = current_user_id
      and id = any(recovered_page_ids)
      and status = 'processing';
  end if;

  return recovered_count;
end;
$$;

create or replace function public.list_review_pages(
  result_limit integer default 50,
  result_offset integer default 0
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  document_kind public.document_kind,
  page_number integer,
  page_status public.processing_status,
  excerpt text,
  warnings jsonb,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recover_stale_ocr_jobs();

  return query
  select
    p.id as page_id,
    d.id as document_id,
    d.title as document_title,
    d.kind as document_kind,
    p.page_number,
    p.status as page_status,
    left(public.page_effective_text(p), 500) as excerpt,
    p.warnings,
    p.updated_at
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and p.status in ('needs_review', 'retryable', 'blocked_quota', 'failed')
  order by
    case p.status
      when 'needs_review' then 1
      when 'retryable' then 2
      when 'blocked_quota' then 3
      else 4
    end,
    p.updated_at asc,
    p.id asc
  limit least(greatest(result_limit, 1), 100)
  offset greatest(result_offset, 0);
end;
$$;

revoke execute on function public.recover_stale_ocr_jobs() from public, anon;
grant execute on function public.recover_stale_ocr_jobs() to authenticated;
