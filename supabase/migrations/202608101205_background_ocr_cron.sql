-- Keep deferred/retryable OCR moving even when no browser is open. Supabase's
-- documented Cron + pg_net pattern reads request credentials from Vault at run
-- time so the credential is never embedded in cron.job or source control.
--
-- Hosted environments must provision these Vault entries:
--   project_url               -> https://<project-ref>.supabase.co
--   ocr_background_worker_key -> the same high-entropy value accepted by
--                                ocr-queue-worker (currently service-role key)
-- Until both exist the cron job is intentionally a no-op.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

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
    )
    select net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/ocr-queue-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Fichario-Worker-Key', worker_key
      ),
      body := jsonb_build_object('source', 'cron'),
      timeout_milliseconds := 5000
    ) as request_id
    from worker_secrets
    where project_url is not null
      and worker_key is not null;
  $cron$
);
