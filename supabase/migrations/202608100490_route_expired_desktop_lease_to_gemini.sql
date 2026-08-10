create or replace function public.set_ocr_job_route(
  target_page_id uuid,
  target_route public.ocr_route
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_job public.ocr_jobs%rowtype;
  next_status public.ocr_status;
  observed_at timestamptz := timezone('utc', now());
  recovered_expired_lease boolean := false;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_page_id is null or target_route is null then
    raise exception using errcode = '22023', message = 'Invalid OCR route request';
  end if;

  select job.*
    into current_job
    from public.ocr_jobs as job
   where job.page_id = target_page_id
     and job.user_id = current_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'OCR job is unavailable for route change';
  end if;

  if current_job.route = target_route then
    return jsonb_build_object(
      'jobId', current_job.id,
      'pageId', current_job.page_id,
      'route', current_job.route,
      'status', current_job.status,
      'recoveredExpiredLease', false
    );
  end if;

  if target_route = 'desktop'::public.ocr_route
    and current_job.route = 'gemini'::public.ocr_route
    and current_job.status = 'pending'::public.ocr_status
    and current_job.desktop_lease_id is null then
    next_status := 'waiting_desktop'::public.ocr_status;
  elsif target_route = 'gemini'::public.ocr_route
    and current_job.route = 'desktop'::public.ocr_route then
    if current_job.status = 'waiting_desktop'::public.ocr_status
      and current_job.desktop_lease_id is null then
      next_status := 'pending'::public.ocr_status;
    elsif current_job.status = 'processing'::public.ocr_status
      and current_job.desktop_lease_id is not null
      and current_job.desktop_lease_expires_at is not null
      and current_job.desktop_lease_expires_at <= observed_at then
      next_status := 'pending'::public.ocr_status;
      recovered_expired_lease := true;
    elsif current_job.desktop_lease_id is not null then
      raise exception using errcode = '55P03', message = 'OCR job has an active desktop lease';
    else
      raise exception using errcode = '55000', message = 'OCR job cannot change route in its current state';
    end if;
  else
    raise exception using errcode = '55000', message = 'OCR job cannot change route in its current state';
  end if;

  update public.ocr_jobs
     set route = target_route,
         status = next_status,
         desktop_lease_device_id = null,
         desktop_lease_id = null,
         desktop_lease_expires_at = null,
         desktop_lease_started_at = null,
         next_retry_at = case when target_route = 'gemini'::public.ocr_route then null else next_retry_at end,
         updated_at = observed_at
   where id = current_job.id
     and user_id = current_user_id;

  return jsonb_build_object(
    'jobId', current_job.id,
    'pageId', current_job.page_id,
    'route', target_route,
    'status', next_status,
    'recoveredExpiredLease', recovered_expired_lease
  );
end;
$$;

revoke execute on function public.set_ocr_job_route(uuid, public.ocr_route) from public;
revoke execute on function public.set_ocr_job_route(uuid, public.ocr_route) from anon;
grant execute on function public.set_ocr_job_route(uuid, public.ocr_route) to authenticated;
grant execute on function public.set_ocr_job_route(uuid, public.ocr_route) to service_role;
