create or replace function public.complete_desktop_ocr_job(
  target_job_id uuid,
  target_device_id uuid,
  target_lease_id uuid,
  target_source_sha256 text,
  target_backend text,
  target_model text,
  target_model_version text,
  extracted_text text,
  target_corrected_text text,
  target_content_type text,
  extraction_warnings jsonb,
  needs_review boolean,
  timing_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_user_id uuid;
  current_job public.ocr_jobs%rowtype;
  current_page public.pages%rowtype;
  persisted_result public.ocr_results%rowtype;
  persisted_result_id uuid;
  terminal_status public.page_status;
  completed_at timestamptz := timezone('utc', now());
  expected_metadata jsonb;
begin
  if target_job_id is null
    or target_device_id is null
    or target_lease_id is null
    or target_source_sha256 is null
    or target_source_sha256 !~ '^[0-9a-f]{64}$'
    or target_backend is null
    or target_backend not in ('transformers', 'ollama')
    or target_model is null
    or char_length(target_model) not between 1 and 128
    or target_model !~ '^[A-Za-z0-9._:/-]+$'
    or target_model_version is null
    or char_length(target_model_version) not between 1 and 128
    or target_model_version !~ '^[A-Za-z0-9._:/+-]+$'
    or extracted_text is null
    or char_length(extracted_text) > 1000000
    or (target_corrected_text is not null and char_length(target_corrected_text) > 1000000)
    or target_content_type is null
    or char_length(target_content_type) not between 1 and 64
    or target_content_type !~ '^[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+$'
    or extraction_warnings is null
    or jsonb_typeof(extraction_warnings) <> 'array'
    or needs_review is null
    or timing_ms is null
    or timing_ms < 0
    or timing_ms > 86400000 then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR completion payload';
  end if;

  select job.user_id
    into lease_user_id
    from public.ocr_jobs as job
   where job.id = target_job_id;

  if not found then
    raise exception using errcode = '55000', message = 'Desktop OCR job is unavailable';
  end if;

  -- Desktop lease functions consistently lock the device before the job. Keep
  -- that ordering here so completion cannot deadlock with renewal/revocation.
  perform 1
    from public.ocr_worker_devices as device
   where device.id = target_device_id
     and device.user_id = lease_user_id
     and device.status = 'active'
   for update;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR device is unavailable';
  end if;

  select job.*
    into current_job
    from public.ocr_jobs as job
   where job.id = target_job_id
     and job.user_id = lease_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'Desktop OCR job is unavailable';
  end if;

  select page.*
    into current_page
    from public.pages as page
   where page.id = current_job.page_id
     and page.user_id = lease_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'Desktop OCR page is unavailable';
  end if;

  terminal_status := case
    when needs_review then 'needs_review'::public.page_status
    else 'ready'::public.page_status
  end;

  expected_metadata := jsonb_build_object(
    'source', 'desktop_worker',
    'desktopDeviceId', target_device_id,
    'desktopLeaseId', target_lease_id,
    'sourceSha256', target_source_sha256,
    'backend', target_backend,
    'modelVersion', target_model_version,
    'timingMs', timing_ms,
    'needsReview', needs_review,
    'promptVersion', current_job.prompt_version,
    'ocrBatchId', current_job.batch_id
  );

  -- A response may be lost after commit. Exact retries are accepted from the
  -- immutable result even though the successful transaction already cleared
  -- the lease and its bound source hash.
  select result.*
    into persisted_result
    from public.ocr_results as result
   where result.ocr_job_id = current_job.id
     and result.page_id = current_page.id
     and result.user_id = lease_user_id;

  if found then
    if current_job.route <> 'desktop'::public.ocr_route
      or current_job.status <> 'ready'::public.ocr_status
      or persisted_result.provider <> 'local'
      or persisted_result.model <> target_model
      or persisted_result.raw_text is distinct from extracted_text
      or persisted_result.corrected_text is distinct from target_corrected_text
      or persisted_result.content_type <> target_content_type
      or persisted_result.warnings is distinct from extraction_warnings
      or persisted_result.metadata is distinct from expected_metadata
      or current_page.status <> terminal_status
      or current_page.ocr_raw_text is distinct from extracted_text
      or current_page.corrected_text is distinct from target_corrected_text
      or current_page.warnings is distinct from extraction_warnings
      or current_page.extraction_source <> 'ocr'::public.extraction_source
      or current_page.accepted_ocr_result_id is distinct from persisted_result.id then
      raise exception using errcode = '22023', message = 'Desktop OCR completion conflicts with the persisted result';
    end if;

    update public.ocr_worker_devices
       set last_seen_at = completed_at,
           updated_at = completed_at
     where id = target_device_id
       and user_id = lease_user_id;

    return jsonb_build_object(
      'jobId', current_job.id,
      'pageId', current_page.id,
      'resultId', persisted_result.id,
      'status', current_page.status,
      'sourceStoragePath', current_page.temporary_image_path,
      'idempotentReplay', true
    );
  end if;

  if current_job.route <> 'desktop'::public.ocr_route
    or current_job.status <> 'processing'::public.ocr_status
    or current_page.status not in ('pending'::public.page_status, 'processing'::public.page_status)
    or current_job.desktop_lease_device_id is distinct from target_device_id
    or current_job.desktop_lease_id is distinct from target_lease_id
    or current_job.desktop_lease_expires_at is null
    or current_job.desktop_lease_expires_at <= completed_at
    or current_job.desktop_source_sha256 is distinct from target_source_sha256
    or current_job.desktop_source_bound_at is null then
    raise exception using errcode = '55P03', message = 'Desktop OCR lease is not active for completion';
  end if;

  insert into public.ocr_results (
    user_id,
    page_id,
    ocr_job_id,
    provider,
    model,
    raw_text,
    corrected_text,
    content_type,
    mean_confidence,
    warnings,
    metadata,
    created_at
  ) values (
    lease_user_id,
    current_page.id,
    current_job.id,
    'local',
    target_model,
    extracted_text,
    target_corrected_text,
    target_content_type,
    null,
    extraction_warnings,
    expected_metadata,
    completed_at
  )
  returning id into persisted_result_id;

  update public.pages
     set ocr_raw_text = extracted_text,
         corrected_text = target_corrected_text,
         warnings = extraction_warnings,
         extraction_source = 'ocr'::public.extraction_source,
         status = terminal_status,
         accepted_ocr_result_id = persisted_result_id
   where id = current_page.id
     and user_id = lease_user_id;

  if not found then
    raise exception using errcode = '55000', message = 'Desktop OCR page disappeared during completion';
  end if;

  update public.ocr_jobs
     set provider = 'local',
         model = target_model,
         status = 'ready'::public.ocr_status,
         finished_at = completed_at,
         last_error_code = null,
         last_error_message = null,
         next_retry_at = null,
         desktop_lease_device_id = null,
         desktop_lease_id = null,
         desktop_lease_expires_at = null,
         desktop_lease_started_at = null,
         updated_at = completed_at
   where id = current_job.id
     and user_id = lease_user_id;

  update public.ocr_worker_devices
     set last_seen_at = completed_at,
         updated_at = completed_at
   where id = target_device_id
     and user_id = lease_user_id;

  return jsonb_build_object(
    'jobId', current_job.id,
    'pageId', current_page.id,
    'resultId', persisted_result_id,
    'status', terminal_status,
    'sourceStoragePath', current_page.temporary_image_path,
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.clear_desktop_ocr_completed_source(
  target_job_id uuid,
  target_result_id uuid,
  expected_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if target_job_id is null
    or target_result_id is null
    or expected_storage_path is null
    or char_length(expected_storage_path) not between 3 and 1024 then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR source cleanup request';
  end if;

  update public.pages as page
     set temporary_image_path = null
    from public.ocr_jobs as job,
         public.ocr_results as result
   where job.id = target_job_id
     and job.page_id = page.id
     and job.user_id = page.user_id
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'ready'::public.ocr_status
     and result.id = target_result_id
     and result.ocr_job_id = job.id
     and result.page_id = page.id
     and result.user_id = page.user_id
     and result.provider = 'local'
     and page.accepted_ocr_result_id = result.id
     and page.temporary_image_path = expected_storage_path;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke execute on function public.complete_desktop_ocr_job(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer
) from public;
revoke execute on function public.complete_desktop_ocr_job(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer
) from anon;
revoke execute on function public.complete_desktop_ocr_job(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer
) from authenticated;
grant execute on function public.complete_desktop_ocr_job(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer
) to service_role;

revoke execute on function public.clear_desktop_ocr_completed_source(uuid, uuid, text) from public;
revoke execute on function public.clear_desktop_ocr_completed_source(uuid, uuid, text) from anon;
revoke execute on function public.clear_desktop_ocr_completed_source(uuid, uuid, text) from authenticated;
grant execute on function public.clear_desktop_ocr_completed_source(uuid, uuid, text) to service_role;
