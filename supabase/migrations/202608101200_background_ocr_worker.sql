-- Background OCR is server-driven after browser ingestion. The browser remains
-- responsible for preparing/uploading private source material, but Gemini work
-- can continue after the app is suspended or closed.

create or replace function public.recover_background_stale_ocr_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_page_ids uuid[];
  recovered_count integer := 0;
begin
  with recovered as (
    update public.ocr_jobs as job
       set status = 'retryable'::public.ocr_status,
           last_error_code = 'stale_processing_claim',
           last_error_message = 'O processamento anterior foi interrompido e pode ser retomado.',
           next_retry_at = timezone('utc', now()),
           started_at = null,
           finished_at = null
      from public.app_users as app_user
     where app_user.user_id = job.user_id
       and app_user.is_active = true
       and job.route = 'gemini'::public.ocr_route
       and job.status = 'processing'::public.ocr_status
       and job.started_at is not null
       and job.started_at <= timezone('utc', now()) - interval '15 minutes'
    returning job.page_id
  )
  select coalesce(array_agg(page_id), '{}'::uuid[])
    into recovered_page_ids
    from recovered;

  recovered_count := cardinality(recovered_page_ids);
  if recovered_count > 0 then
    update public.pages as page
       set status = 'retryable'::public.page_status
     where page.id = any(recovered_page_ids)
       and page.status = 'processing'::public.page_status;
  end if;
  return recovered_count;
end;
$$;

create or replace function public.list_background_gemini_ocr_candidates(result_limit integer default 24)
returns table (
  user_id uuid,
  job_id uuid,
  page_id uuid,
  document_id uuid,
  page_number integer,
  attempt_count integer,
  batch_id uuid,
  temporary_image_path text,
  document_kind public.document_kind,
  document_storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if result_limit is null or result_limit < 1 or result_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid background OCR limit';
  end if;

  return query
  select
    job.user_id,
    job.id,
    page.id,
    page.document_id,
    page.page_number,
    job.attempt_count,
    job.batch_id,
    page.temporary_image_path,
    document.kind,
    document.storage_path
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  join public.app_users as app_user
    on app_user.user_id = job.user_id
   and app_user.is_active = true
   and app_user.ocr_consent_at is not null
   and app_user.ocr_consent_version >= 1
  where job.route = 'gemini'::public.ocr_route
    and job.status in (
      'pending'::public.ocr_status,
      'retryable'::public.ocr_status,
      'blocked_quota'::public.ocr_status
    )
    and page.status in (
      'pending'::public.page_status,
      'retryable'::public.page_status,
      'blocked_quota'::public.page_status
    )
    and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
    and job.desktop_lease_device_id is null
    and job.desktop_lease_id is null
    and job.desktop_lease_started_at is null
    and job.desktop_lease_expires_at is null
    and (
      page.temporary_image_path is not null
      or (document.kind = 'image'::public.document_kind and document.storage_path is not null)
    )
  order by job.created_at, job.id
  limit result_limit;
end;
$$;

-- Reuse the existing, heavily-tested user-scoped OCR transaction boundaries
-- without granting the worker broad ad-hoc write access. Only service_role may
-- invoke this dispatcher, and each nested RPC still scopes rows to auth.uid().
create or replace function public.background_ocr_as_user(
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
  args jsonb;
  bool_result boolean;
  claim_result jsonb;
begin
  if target_user_id is null
    or payload is null
    or jsonb_typeof(payload) <> 'object'
    or operation not in (
      'claim',
      'fail',
      'block_quota',
      'clear_temporary_image',
      'complete_geometry',
      'record_batch_call',
      'record_provider_usage'
    )
  then
    raise exception using errcode = '22023', message = 'Invalid background OCR operation';
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

  if operation = 'claim' then
    claim_result := public.claim_ocr_job(
      (payload ->> 'pageId')::uuid,
      payload ->> 'model',
      (payload ->> 'claimedAt')::timestamptz
    );
    return jsonb_build_object('ok', true, 'value', claim_result);
  end if;

  if operation = 'fail' then
    bool_result := public.fail_ocr_job(
      (payload ->> 'pageId')::uuid,
      payload ->> 'code',
      payload ->> 'message',
      (payload ->> 'retryable')::boolean,
      (payload ->> 'failedAt')::timestamptz,
      (payload ->> 'retryAt')::timestamptz
    );
    return jsonb_build_object('ok', bool_result);
  end if;

  if operation = 'block_quota' then
    bool_result := public.block_ocr_job_quota(
      (payload ->> 'pageId')::uuid,
      payload ->> 'code',
      (payload ->> 'blockedAt')::timestamptz
    );
    return jsonb_build_object('ok', bool_result);
  end if;

  if operation = 'clear_temporary_image' then
    bool_result := public.clear_temporary_page_image(
      (payload ->> 'pageId')::uuid,
      payload ->> 'path'
    );
    return jsonb_build_object('ok', bool_result);
  end if;

  if operation = 'complete_geometry' then
    perform public.complete_ocr_job_with_geometry(
      (payload ->> 'pageId')::uuid,
      payload ->> 'text',
      coalesce(payload -> 'warnings', '[]'::jsonb),
      (payload ->> 'status')::public.page_status,
      (payload ->> 'completedAt')::timestamptz,
      coalesce(payload -> 'geometry', '[]'::jsonb)
    );
    return jsonb_build_object('ok', true);
  end if;

  if operation = 'record_batch_call' then
    bool_result := public.record_ocr_batch_call(
      (payload ->> 'batchId')::uuid,
      (payload ->> 'attemptedPages')::integer,
      (payload ->> 'calledAt')::timestamptz
    );
    return jsonb_build_object('ok', bool_result);
  end if;

  args := payload -> 'args';
  if args is null or jsonb_typeof(args) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid provider telemetry payload';
  end if;

  bool_result := public.record_ocr_provider_usage(
    (args ->> 'target_event_id')::uuid,
    (args ->> 'target_document_id')::uuid,
    (args ->> 'target_batch_id')::uuid,
    args ->> 'target_provider',
    args ->> 'target_model',
    args ->> 'target_provider_model_version',
    (args ->> 'target_prompt_version')::integer,
    (args ->> 'target_document_kind')::public.document_kind,
    args ->> 'terminal_status',
    args ->> 'target_safe_error_code',
    args -> 'target_page_metrics',
    (args ->> 'target_latency_ms')::integer,
    (args ->> 'target_prompt_token_count')::bigint,
    (args ->> 'target_cached_content_token_count')::bigint,
    (args ->> 'target_candidates_token_count')::bigint,
    (args ->> 'target_tool_use_prompt_token_count')::bigint,
    (args ->> 'target_thoughts_token_count')::bigint,
    (args ->> 'target_total_token_count')::bigint,
    args ->> 'target_service_tier',
    args ->> 'target_provider_response_id',
    args -> 'target_usage_details',
    (args ->> 'recorded_at')::timestamptz
  );
  return jsonb_build_object('ok', bool_result);
end;
$$;

create or replace function public.reconcile_background_ocr_batches(
  target_batch_ids uuid[],
  reconciled_at timestamptz default timezone('utc', now())
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  changed_count integer := 0;
  next_status public.processing_status;
  next_retry timestamptz;
begin
  if target_batch_ids is null
    or cardinality(target_batch_ids) > 100
    or array_position(target_batch_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'Invalid OCR batch reconciliation';
  end if;

  for target_id in
    select distinct value from unnest(target_batch_ids) as value
  loop
    if not exists (
      select 1 from public.ocr_batches
       where id = target_id and route = 'gemini'
    ) then
      continue;
    end if;

    if exists (select 1 from public.ocr_jobs where batch_id = target_id and status = 'processing') then
      next_status := 'processing';
      next_retry := null;
    elsif exists (select 1 from public.ocr_jobs where batch_id = target_id and status in ('pending', 'retryable')) then
      next_status := 'retryable';
      select min(next_retry_at) into next_retry
        from public.ocr_jobs
       where batch_id = target_id and status in ('pending', 'retryable');
    elsif exists (select 1 from public.ocr_jobs where batch_id = target_id and status = 'blocked_quota') then
      next_status := 'blocked_quota';
      select min(next_retry_at) into next_retry
        from public.ocr_jobs
       where batch_id = target_id and status = 'blocked_quota';
    elsif exists (select 1 from public.ocr_jobs where batch_id = target_id and status = 'failed') then
      next_status := 'failed';
      next_retry := null;
    else
      next_status := 'ready';
      next_retry := null;
    end if;

    update public.ocr_batches
       set status = next_status,
           next_retry_at = next_retry,
           finished_at = case when next_status in ('ready', 'failed') then reconciled_at else null end,
           started_at = case when next_status = 'processing' then coalesce(started_at, reconciled_at) else started_at end
     where id = target_id
       and route = 'gemini';
    if found then changed_count := changed_count + 1; end if;
  end loop;

  return changed_count;
end;
$$;

revoke execute on function public.recover_background_stale_ocr_jobs() from public, anon, authenticated;
revoke execute on function public.list_background_gemini_ocr_candidates(integer) from public, anon, authenticated;
revoke execute on function public.background_ocr_as_user(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.reconcile_background_ocr_batches(uuid[], timestamptz) from public, anon, authenticated;

grant execute on function public.recover_background_stale_ocr_jobs() to service_role;
grant execute on function public.list_background_gemini_ocr_candidates(integer) to service_role;
grant execute on function public.background_ocr_as_user(uuid, text, jsonb) to service_role;
grant execute on function public.reconcile_background_ocr_batches(uuid[], timestamptz) to service_role;
