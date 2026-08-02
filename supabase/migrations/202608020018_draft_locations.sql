create or replace function public.resolve_page_locations(target_page_ids uuid[])
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  page_updated_at timestamptz
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
    p.updated_at
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and cardinality(target_page_ids) between 1 and 100
    and p.id = any(target_page_ids)
  order by p.updated_at desc, p.id;
$$;

revoke execute on function public.resolve_page_locations(uuid[]) from public, anon;
grant execute on function public.resolve_page_locations(uuid[]) to authenticated;
