create or replace function public.list_notebooks()
returns table (
  id uuid,
  name text,
  description text,
  cover_style text,
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
    n.created_at,
    n.updated_at,
    count(d.id)::bigint as document_count
  from public.notebooks n
  left join public.documents d
    on d.notebook_id = n.id
    and d.user_id = n.user_id
  where n.user_id = (select auth.uid())
    and (select public.is_authorized_user())
  group by n.id, n.name, n.description, n.cover_style, n.created_at, n.updated_at
  order by n.updated_at desc, n.id desc;
$$;

create or replace function public.delete_notebook(target_notebook_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_rows integer;
begin
  if not (select public.is_authorized_user()) then
    return false;
  end if;

  update public.documents
  set notebook_id = null
  where notebook_id = target_notebook_id
    and user_id = (select auth.uid());

  delete from public.notebooks
  where id = target_notebook_id
    and user_id = (select auth.uid());

  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

revoke execute on function public.list_notebooks() from public, anon;
grant execute on function public.list_notebooks() to authenticated;

revoke execute on function public.delete_notebook(uuid) from public, anon;
grant execute on function public.delete_notebook(uuid) to authenticated;
