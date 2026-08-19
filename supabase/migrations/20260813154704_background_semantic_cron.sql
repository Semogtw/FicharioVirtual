-- Keep semantic embeddings current without requiring a search or coverage request.
-- The worker only sees pages whose effective text is present and whose embedding
-- hash is missing/stale. It reuses the same internal worker credential as OCR.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'fichario-background-semantic-index',
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
      url := rtrim(project_url, '/') || '/functions/v1/semantic-index-worker',
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
