-- Wake the low-priority visual semantic worker when an eligible page is queued.
-- A five-minute cron remains the recovery path for lost wakeups. Dispatch is
-- globally debounced so a multi-page OCR batch does not fan out HTTP requests.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.visual_embedding_dispatch_state (
  singleton boolean primary key default true check (singleton),
  last_dispatched_at timestamptz not null default to_timestamp(0)
);

alter table public.visual_embedding_dispatch_state enable row level security;
alter table public.visual_embedding_dispatch_state force row level security;
revoke all on table public.visual_embedding_dispatch_state from public, anon, authenticated;
grant all on table public.visual_embedding_dispatch_state to service_role;

insert into public.visual_embedding_dispatch_state (singleton, last_dispatched_at)
values (true, to_timestamp(0))
on conflict (singleton) do nothing;

create or replace function public.dispatch_visual_embedding_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  worker_key text;
  should_dispatch boolean := false;
begin
  if new.status <> 'queued' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'queued' then
    return new;
  end if;

  update public.visual_embedding_dispatch_state
  set last_dispatched_at = now()
  where singleton = true
    and last_dispatched_at < now() - interval '10 seconds'
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
    url := rtrim(project_url, '/') || '/functions/v1/semantic-visual-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Fichario-Worker-Key', worker_key
    ),
    body := jsonb_build_object('source', 'visual_job_queued'),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke execute on function public.dispatch_visual_embedding_worker()
  from public, anon, authenticated;

drop trigger if exists page_visual_embedding_jobs_dispatch on public.page_visual_embedding_jobs;
create trigger page_visual_embedding_jobs_dispatch
after insert or update of status
on public.page_visual_embedding_jobs
for each row execute function public.dispatch_visual_embedding_worker();

select cron.schedule(
  'fichario-background-visual-index',
  '*/5 * * * *',
  $cron$
    with worker_secrets as (
      select
        max(decrypted_secret) filter (where name = 'project_url') as project_url,
        max(decrypted_secret) filter (where name = 'ocr_background_worker_key') as worker_key
      from vault.decrypted_secrets
      where name in ('project_url', 'ocr_background_worker_key')
    )
    select net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/semantic-visual-worker',
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
