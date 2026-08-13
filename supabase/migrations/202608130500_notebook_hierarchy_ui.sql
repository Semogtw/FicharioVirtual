create or replace function public.list_notebooks_v2()
returns table (
  id uuid,
  name text,
  description text,
  cover_style text,
  parent_notebook_id uuid,
  banner_path text,
  banner_position_x smallint,
  banner_position_y smallint,
  created_at timestamptz,
  updated_at timestamptz,
  document_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    n.id,
    n.name,
    n.description,
    n.cover_style,
    n.parent_notebook_id,
    n.banner_path,
    n.banner_position_x,
    n.banner_position_y,
    n.created_at,
    n.updated_at,
    count(d.id)::bigint as document_count
  from public.notebooks n
  left join public.documents d
    on d.notebook_id = n.id
    and d.user_id = n.user_id
  where n.user_id = (select auth.uid())
    and (select public.is_authorized_user())
  group by
    n.id,
    n.name,
    n.description,
    n.cover_style,
    n.parent_notebook_id,
    n.banner_path,
    n.banner_position_x,
    n.banner_position_y,
    n.created_at,
    n.updated_at
  order by n.updated_at desc, n.id desc;
$$;

revoke execute on function public.list_notebooks_v2() from public, anon;
grant execute on function public.list_notebooks_v2() to authenticated;
