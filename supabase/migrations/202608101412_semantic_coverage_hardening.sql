create or replace function public.list_pages_needing_semantic_index(
  target_model text,
  notebook_filter uuid default null,
  result_limit integer default 16
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  source_text text,
  source_hash text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    d.id,
    d.title,
    p.page_number,
    left(public.page_effective_text(p), 24000),
    public.semantic_source_hash(public.page_effective_text(p))
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and target_model ~ '^[A-Za-z0-9._-]{3,128}$'
    and (notebook_filter is null or d.notebook_id = notebook_filter)
    and public.page_effective_text(p) <> ''
    and not exists (
      select 1
      from public.page_semantic_chunks c
      where c.page_id = p.id
        and c.user_id = p.user_id
        and c.model = target_model
        and c.source_hash = public.semantic_source_hash(public.page_effective_text(p))
    )
  order by p.updated_at desc, p.id
  limit least(greatest(coalesce(result_limit, 16), 1), 64);
$$;

revoke execute on function public.semantic_source_hash(text) from public, anon;
grant execute on function public.semantic_source_hash(text) to authenticated;
