-- Public profiles may use lexical search and Azure OCR, but never enter the
-- owner-only Gemini document or visual embedding pipelines.

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
   and a.provider_profile = 'owner'
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
      and provider_profile = 'owner'
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

-- Avoid waking a Gemini worker for a public page at all. The user/profile
-- check is repeated in the worker RPCs so a direct or stale invocation also
-- fails closed.
create or replace function public.dispatch_semantic_index_on_text_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_text text;
  previous_text text := '';
  project_url text;
  worker_key text;
  should_dispatch boolean := false;
begin
  if not exists (
    select 1
    from public.app_users
    where user_id = new.user_id
      and is_active = true
      and provider_profile = 'owner'
  ) then
    return new;
  end if;

  effective_text := public.page_effective_text(new);
  if effective_text = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    previous_text := public.page_effective_text(old);
    if effective_text is not distinct from previous_text then
      return new;
    end if;
  end if;

  insert into public.semantic_background_dispatch_state (user_id, last_dispatched_at)
  values (new.user_id, now())
  on conflict (user_id) do update
    set last_dispatched_at = excluded.last_dispatched_at
    where public.semantic_background_dispatch_state.last_dispatched_at
      < now() - interval '5 seconds'
  returning true into should_dispatch;

  if not coalesce(should_dispatch, false) then
    return new;
  end if;

  select
    max(decrypted_secret) filter (where name = 'project_url'),
    max(decrypted_secret) filter (where name = 'ocr_background_worker_key')
  into project_url, worker_key
  from vault.decrypted_secrets
  where name in ('project_url', 'ocr_background_worker_key');

  if project_url is null or worker_key is null then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/semantic-index-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Fichario-Worker-Key', worker_key
    ),
    body := jsonb_build_object('source', 'page_text_change'),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

create or replace function public.prevent_non_owner_visual_embedding_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_users
    where user_id = new.user_id
      and is_active = true
      and provider_profile = 'owner'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Public accounts cannot use Gemini visual embeddings';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_non_owner_visual_embedding_job_insert
  on public.page_visual_embedding_jobs;
create trigger prevent_non_owner_visual_embedding_job_insert
before insert or update of user_id on public.page_visual_embedding_jobs
for each row execute function public.prevent_non_owner_visual_embedding_job();

revoke execute on function public.prevent_non_owner_visual_embedding_job()
  from public, anon, authenticated;
grant execute on function public.prevent_non_owner_visual_embedding_job()
  to service_role;

create or replace function public.claim_page_visual_embedding_jobs(
  target_model text,
  result_limit integer default 4
)
returns table (
  job_id uuid,
  user_id uuid,
  page_id uuid,
  document_id uuid,
  document_kind text,
  media_path text,
  mime_type text,
  routing_version text,
  routing_reason text,
  attempt_count integer,
  temporary_media boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or result_limit is null
    or result_limit < 1
    or result_limit > 6 then
    raise exception using errcode = '22023', message = 'Invalid visual worker claim';
  end if;

  return query
  with candidates as (
    select j.id
    from public.page_visual_embedding_jobs j
    join public.app_users a
      on a.user_id = j.user_id
     and a.is_active = true
     and a.provider_profile = 'owner'
    where j.model = target_model
      and (
        j.status in ('queued', 'retryable', 'blocked_quota')
        or (j.status = 'processing' and j.claimed_at < now() - interval '5 minutes')
      )
      and (j.retry_after is null or j.retry_after <= now())
    order by coalesce(j.retry_after, j.created_at), j.created_at, j.id
    for update of j skip locked
    limit result_limit
  ), claimed as (
    update public.page_visual_embedding_jobs j
    set status = 'processing',
        attempt_count = least(j.attempt_count + 1, 100),
        claimed_at = now(),
        updated_at = now(),
        safe_error_code = null
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select
    c.id,
    c.user_id,
    c.page_id,
    c.document_id,
    c.document_kind,
    c.media_path,
    c.mime_type,
    c.routing_version,
    c.routing_reason,
    c.attempt_count,
    c.temporary_media
  from claimed c
  order by c.claimed_at, c.id;
end;
$$;

revoke execute on function public.list_background_semantic_users(text, integer)
  from public, anon, authenticated;
grant execute on function public.list_background_semantic_users(text, integer)
  to service_role;

revoke execute on function public.background_semantic_as_user(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.background_semantic_as_user(uuid, text, jsonb)
  to service_role;

revoke execute on function public.dispatch_semantic_index_on_text_change()
  from public, anon, authenticated;
grant execute on function public.dispatch_semantic_index_on_text_change()
  to service_role;

revoke execute on function public.claim_page_visual_embedding_jobs(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_page_visual_embedding_jobs(text, integer)
  to service_role;
