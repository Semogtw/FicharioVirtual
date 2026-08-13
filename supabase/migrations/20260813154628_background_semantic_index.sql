-- Run semantic indexing independently from OCR and browser sessions.
-- service_role may impersonate one active app user only through this narrow
-- dispatcher; the existing user-scoped semantic RPCs remain the source of truth.

create or replace function public.list_background_semantic_users(
  target_model text,
  result_limit integer default 8
)
returns table (user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or result_limit is null
    or result_limit < 1
    or result_limit > 64 then
    raise exception using errcode = '22023', message = 'Invalid background semantic lookup';
  end if;

  return query
  select p.user_id
  from public.pages p
  join public.documents d
    on d.id = p.document_id
   and d.user_id = p.user_id
  join public.app_users a
    on a.user_id = p.user_id
   and a.is_active = true
  where public.page_effective_text(p) <> ''
    and not exists (
      select 1
      from public.page_semantic_chunks c
      where c.page_id = p.id
        and c.user_id = p.user_id
        and c.model = target_model
        and c.source_hash = public.semantic_source_hash(public.page_effective_text(p))
    )
    and not exists (
      select 1
      from public.semantic_index_failures f
      where f.page_id = p.id
        and f.user_id = p.user_id
        and f.model = target_model
        and f.retry_after > now()
    )
  group by p.user_id
  order by max(p.updated_at) desc, p.user_id
  limit result_limit;
end;
$$;

create or replace function public.background_semantic_as_user(
  target_user_id uuid,
  operation text,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  stored_count integer;
  failure_count integer;
begin
  if target_user_id is null
    or payload is null
    or jsonb_typeof(payload) <> 'object'
    or operation not in ('list', 'replace', 'record_failure') then
    raise exception using errcode = '22023', message = 'Invalid background semantic operation';
  end if;

  if not exists (
    select 1
    from public.app_users
    where user_id = target_user_id
      and is_active = true
  ) then
    return jsonb_build_object('ok', false, 'code', 'user_unavailable');
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', target_user_id, 'role', 'authenticated')::text,
    true
  );

  if operation = 'list' then
    select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb)
      into result
      from public.list_pages_needing_semantic_index(
        payload ->> 'model',
        null,
        coalesce((payload ->> 'limit')::integer, 8)
      ) as item;
    return jsonb_build_object('ok', true, 'value', result);
  end if;

  if operation = 'replace' then
    stored_count := public.replace_page_semantic_chunks(
      (payload ->> 'pageId')::uuid,
      payload ->> 'model',
      payload ->> 'sourceHash',
      coalesce(payload -> 'chunks', '[]'::jsonb)
    );
    return jsonb_build_object('ok', true, 'value', stored_count);
  end if;

  failure_count := public.record_semantic_index_failure(
    (payload ->> 'pageId')::uuid,
    payload ->> 'model',
    payload ->> 'status'
  );
  return jsonb_build_object('ok', true, 'value', failure_count);
end;
$$;

revoke execute on function public.list_background_semantic_users(text, integer)
  from public, anon, authenticated;
revoke execute on function public.background_semantic_as_user(uuid, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.list_background_semantic_users(text, integer)
  to service_role;
grant execute on function public.background_semantic_as_user(uuid, text, jsonb)
  to service_role;
