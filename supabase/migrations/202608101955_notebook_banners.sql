alter table public.notebooks
  add column if not exists banner_path text,
  add column if not exists banner_position_x smallint not null default 50,
  add column if not exists banner_position_y smallint not null default 50;

alter table public.notebooks
  drop constraint if exists notebooks_banner_path_check,
  drop constraint if exists notebooks_banner_position_x_check,
  drop constraint if exists notebooks_banner_position_y_check;

alter table public.notebooks
  add constraint notebooks_banner_path_check check (
    banner_path is null
    or (
      char_length(banner_path) between 3 and 1024
      and banner_path like user_id::text || '/notebook-banners/' || id::text || '/%'
      and position('/../' in '/' || banner_path || '/') = 0
    )
  ),
  add constraint notebooks_banner_position_x_check check (banner_position_x between 0 and 100),
  add constraint notebooks_banner_position_y_check check (banner_position_y between 0 and 100);

drop function if exists public.list_notebooks();

create function public.list_notebooks()
returns table (
  id uuid,
  name text,
  description text,
  cover_style text,
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
    n.banner_path,
    n.banner_position_x,
    n.banner_position_y,
    n.created_at,
    n.updated_at
  order by n.updated_at desc, n.id desc;
$$;

revoke execute on function public.list_notebooks() from public, anon;
grant execute on function public.list_notebooks() to authenticated;
