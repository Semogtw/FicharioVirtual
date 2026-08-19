-- Retryable OCR jobs can become due seconds after a worker invocation ends.
-- Wake the queue once per minute, but only call the Edge Function when there is
-- actually due Gemini work. This keeps retries responsive without polling the
-- provider or invoking the worker unnecessarily.

do $$
begin
  if exists (
    select 1
      from cron.job
     where jobname = 'fichario-background-ocr-wakeup'
  ) then
    perform cron.unschedule('fichario-background-ocr-wakeup');
  end if;
end;
$$;

select cron.schedule(
  'fichario-background-ocr-wakeup',
  '* * * * *',
  $cron$
    with worker_secrets as (
      select
        max(decrypted_secret) filter (where name = 'project_url') as project_url,
        max(decrypted_secret) filter (where name = 'ocr_background_worker_key') as worker_key
      from vault.decrypted_secrets
      where name in ('project_url', 'ocr_background_worker_key')
    ),
    due_work as (
      select exists (
        select 1
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
         where job.route = 'gemini'::public.ocr_route
           and (
             (
               job.status in ('pending'::public.ocr_status, 'retryable'::public.ocr_status)
               and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
             )
             or (
               job.status = 'blocked_quota'::public.ocr_status
               and job.next_retry_at is not null
               and job.next_retry_at <= timezone('utc', now())
             )
           )
           and page.status in (
             'pending'::public.page_status,
             'retryable'::public.page_status,
             'blocked_quota'::public.page_status
           )
           and job.desktop_lease_device_id is null
           and job.desktop_lease_id is null
           and job.desktop_lease_started_at is null
           and job.desktop_lease_expires_at is null
           and (
             page.temporary_image_path is not null
             or (document.kind = 'image'::public.document_kind and document.storage_path is not null)
           )
      ) as has_due
    )
    select net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/ocr-queue-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Fichario-Worker-Key', worker_key
      ),
      body := jsonb_build_object('source', 'cron-due-work'),
      timeout_milliseconds := 5000
    ) as request_id
    from worker_secrets
    cross join due_work
    where project_url is not null
      and worker_key is not null
      and due_work.has_due;
  $cron$
);
