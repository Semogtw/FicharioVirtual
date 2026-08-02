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
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.list_review_pages(integer, integer) from public, anon;
grant execute on function public.list_review_pages(integer, integer) to authenticated;
