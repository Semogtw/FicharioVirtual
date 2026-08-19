-- Wake the semantic worker as soon as effective page text changes. Wakeups are
-- debounced per user so a multi-page import does not fan out one HTTP request
-- per page. The minute cron remains the recovery path if a wakeup is lost.

create table public.semantic_background_dispatch_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_dispatched_at timestamptz not null default now()
);

alter table public.semantic_background_dispatch_state enable row level security;
alter table public.semantic_background_dispatch_state force row level security;
revoke all on table public.semantic_background_dispatch_state from public, anon, authenticated;

-- Document embeddings are background-owned now. Interactive search/coverage
-- only create query embeddings and read already-indexed document vectors.
revoke execute on function public.list_pages_needing_semantic_index(text, uuid, integer)
  from authenticated;
revoke execute on function public.replace_page_semantic_chunks(uuid, text, text, jsonb)
  from authenticated;
revoke execute on function public.record_semantic_index_failure(uuid, text, text)
  from authenticated;

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

revoke execute on function public.dispatch_semantic_index_on_text_change()
  from public, anon, authenticated;

drop trigger if exists pages_dispatch_semantic_index on public.pages;
create trigger pages_dispatch_semantic_index
after insert or update of native_text, ocr_raw_text, corrected_text
on public.pages
for each row execute function public.dispatch_semantic_index_on_text_change();
