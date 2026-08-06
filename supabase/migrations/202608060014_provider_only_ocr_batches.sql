-- Provider quotas are authoritative. Local counters remain informational only.

alter table public.usage_daily
  add column if not exists ocr_batches integer not null default 0 check (ocr_batches >= 0),
  add column if not exists ocr_calls integer not null default 0 check (ocr_calls >= 0),
  add column if not exists ocr_attempts integer not null default 0 check (ocr_attempts >= 0);

create table public.ocr_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  route text not null default 'gemini' check (route in ('gemini', 'desktop')),
  status public.processing_status not null default 'pending',
  page_ids uuid[] not null check (cardinality(page_ids) between 1 and 1000),
  page_numbers integer[] not null,
  source_bytes bigint not null default 0 check (source_bytes >= 0),
  derived_bytes bigint not null default 0 check (derived_bytes >= 0),
  split_depth integer not null default 0 check (split_depth between 0 and 32),
  parent_batch_id uuid,
  model text check (model is null or char_length(model) between 1 and 128),
  prompt_version integer not null default 1 check (prompt_version between 1 and 10000),
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000000),
  provider_call_count integer not null default 0 check (provider_call_count between 0 and 10000),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) <= 500
  ),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  check (cardinality(page_numbers) = cardinality(page_ids))
);

alter table public.ocr_batches
  add constraint ocr_batches_parent_fkey
  foreign key (parent_batch_id)
  references public.ocr_batches(id)
  on delete set null;

create index ocr_batches_user_state_idx
  on public.ocr_batches (user_id, status, next_retry_at, created_at);
create index ocr_batches_document_idx
  on public.ocr_batches (document_id, created_at);
create index ocr_batches_parent_idx
  on public.ocr_batches (parent_batch_id)
  where parent_batch_id is not null;

create trigger ocr_batches_set_updated_at
before update on public.ocr_batches
for each row execute function public.set_updated_at();

alter table public.ocr_jobs
  add column if not exists batch_id uuid references public.ocr_batches(id) on delete set null,
  add column if not exists batch_ordinal integer check (batch_ordinal is null or batch_ordinal >= 0);

create index ocr_jobs_batch_idx
  on public.ocr_jobs (batch_id, batch_ordinal)
  where batch_id is not null;

alter table public.ocr_batches enable row level security;
alter table public.ocr_batches force row level security;

create policy ocr_batches_owner_all
on public.ocr_batches
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

revoke all on table public.ocr_batches from anon;
revoke all on table public.ocr_batches from authenticated;
grant select, insert, update, delete on table public.ocr_batches to authenticated;

create or replace function public.claim_ocr_job(
  target_page_id uuid,
  target_model text,
  claimed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_job record;
  usage_count integer;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    return jsonb_build_object('state', 'not_authorized');
  end if;
  if not exists (
    select 1 from public.app_users
    where user_id = current_user_id
      and is_active = true
      and ocr_consent_at is not null
      and ocr_consent_version >= 1
  ) then
    return jsonb_build_object('state', 'consent_required');
  end if;
  if target_model is null
    or char_length(target_model) not between 3 and 128
    or target_model !~ '^[A-Za-z0-9._-]+$'
  then
    return jsonb_build_object('state', 'invalid_configuration');
  end if;

  select
    j.id as job_id,
    j.status as job_status,
    j.attempt_count,
    j.next_retry_at,
    p.status as page_status,
    coalesce(nullif(p.corrected_text, ''), nullif(p.ocr_raw_text, '')) as existing_text
  into current_job
  from public.ocr_jobs j
  join public.pages p on p.id = j.page_id and p.user_id = j.user_id
  where j.page_id = target_page_id
    and j.user_id = current_user_id
  for update of j, p;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if current_job.existing_text is not null
    and current_job.page_status in ('ready', 'needs_review')
  then
    return jsonb_build_object('state', 'already_complete', 'jobId', current_job.job_id);
  end if;
  if current_job.job_status = 'processing' then
    return jsonb_build_object('state', 'busy', 'jobId', current_job.job_id);
  end if;
  if current_job.next_retry_at is not null and current_job.next_retry_at > claimed_at then
    return jsonb_build_object(
      'state', 'retry_later',
      'jobId', current_job.job_id,
      'nextRetryAt', current_job.next_retry_at
    );
  end if;
  if current_job.job_status not in ('pending', 'retryable', 'blocked_quota') then
    return jsonb_build_object('state', 'not_retryable', 'jobId', current_job.job_id);
  end if;

  update public.ocr_jobs
  set status = 'processing',
      model = target_model,
      attempt_count = attempt_count + 1,
      last_error_code = null,
      last_error_message = null,
      next_retry_at = null,
      started_at = claimed_at,
      finished_at = null
  where id = current_job.job_id;

  update public.pages
  set status = 'processing'
  where id = target_page_id and user_id = current_user_id;

  insert into public.usage_daily (
    user_id, usage_date, ocr_pages, ocr_attempts, updated_at
  ) values (
    current_user_id, (claimed_at at time zone 'utc')::date, 1, 1, claimed_at
  )
  on conflict (user_id, usage_date) do update
  set ocr_pages = public.usage_daily.ocr_pages + 1,
      ocr_attempts = public.usage_daily.ocr_attempts + 1,
      updated_at = excluded.updated_at
  returning ocr_pages into usage_count;

  return jsonb_build_object(
    'state', 'claimed',
    'jobId', current_job.job_id,
    'attemptCount', current_job.attempt_count + 1,
    'usageToday', usage_count
  );
end;
$$;

create or replace function public.register_ocr_batch(
  target_document_id uuid,
  target_route text,
  target_page_ids uuid[],
  target_page_numbers integer[],
  target_source_bytes bigint,
  target_derived_bytes bigint,
  target_split_depth integer,
  target_parent_batch_id uuid,
  target_model text,
  target_prompt_version integer,
  registered_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  created_batch_id uuid;
  item_count integer;
  matched_pages integer;
begin
  item_count := cardinality(target_page_ids);
  if current_user_id is null
    or not (select public.is_authorized_user())
    or target_route not in ('gemini', 'desktop')
    or item_count is null or item_count < 1 or item_count > 1000
    or cardinality(target_page_numbers) <> item_count
    or array_position(target_page_ids, null) is not null
    or array_position(target_page_numbers, null) is not null
    or target_source_bytes < 0 or target_derived_bytes < 0
    or target_split_depth not between 0 and 32
    or target_prompt_version not between 1 and 10000
    or (target_model is not null and (
      char_length(target_model) not between 1 and 128
      or target_model !~ '^[A-Za-z0-9._-]+$'
    ))
  then
    return null;
  end if;

  if exists (select 1 from unnest(target_page_numbers) n where n < 1)
    or exists (
      select 1 from unnest(target_page_ids) value group by value having count(*) > 1
    )
    or exists (
      select 1 from unnest(target_page_numbers) value group by value having count(*) > 1
    )
  then
    return null;
  end if;

  select count(*) into matched_pages
  from unnest(target_page_ids, target_page_numbers) requested(page_id, page_number)
  join public.pages p
    on p.id = requested.page_id
   and p.page_number = requested.page_number
  where p.user_id = current_user_id
    and p.document_id = target_document_id;
  if matched_pages <> item_count then return null; end if;

  if target_parent_batch_id is not null and not exists (
    select 1 from public.ocr_batches
    where id = target_parent_batch_id and user_id = current_user_id
  ) then
    return null;
  end if;

  insert into public.ocr_batches (
    user_id, document_id, route, page_ids, page_numbers,
    source_bytes, derived_bytes, split_depth, parent_batch_id,
    model, prompt_version, created_at, updated_at
  ) values (
    current_user_id, target_document_id, target_route, target_page_ids, target_page_numbers,
    target_source_bytes, target_derived_bytes, target_split_depth, target_parent_batch_id,
    target_model, target_prompt_version, registered_at, registered_at
  ) returning id into created_batch_id;

  update public.ocr_jobs j
  set batch_id = created_batch_id,
      batch_ordinal = ordered.ordinality - 1
  from unnest(target_page_ids) with ordinality ordered(page_id, ordinality)
  where j.user_id = current_user_id
    and j.page_id = ordered.page_id;

  insert into public.usage_daily (user_id, usage_date, ocr_batches, updated_at)
  values (current_user_id, (registered_at at time zone 'utc')::date, 1, registered_at)
  on conflict (user_id, usage_date) do update
  set ocr_batches = public.usage_daily.ocr_batches + 1,
      updated_at = excluded.updated_at;

  return created_batch_id;
end;
$$;

create or replace function public.record_ocr_batch_call(
  target_batch_id uuid,
  attempted_pages integer,
  called_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null or attempted_pages < 1 or attempted_pages > 1000 then
    return false;
  end if;

  update public.ocr_batches
  set status = 'processing',
      attempt_count = attempt_count + attempted_pages,
      provider_call_count = provider_call_count + 1,
      started_at = coalesce(started_at, called_at),
      last_error_code = null,
      last_error_message = null,
      next_retry_at = null
  where id = target_batch_id
    and user_id = current_user_id
    and status in ('pending', 'retryable', 'blocked_quota', 'processing');
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then return false; end if;

  insert into public.usage_daily (user_id, usage_date, ocr_calls, updated_at)
  values (current_user_id, (called_at at time zone 'utc')::date, 1, called_at)
  on conflict (user_id, usage_date) do update
  set ocr_calls = public.usage_daily.ocr_calls + 1,
      updated_at = excluded.updated_at;

  return true;
end;
$$;

create or replace function public.finish_ocr_batch(
  target_batch_id uuid,
  terminal_status text,
  error_code text,
  safe_error_message text,
  retry_at timestamptz,
  finished_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null
    or terminal_status not in ('ready', 'retryable', 'blocked_quota', 'failed')
    or (error_code is not null and error_code !~ '^[a-z0-9_]{1,64}$')
    or (safe_error_message is not null and char_length(safe_error_message) > 500)
    or (terminal_status in ('retryable', 'blocked_quota') and retry_at is null)
  then
    return false;
  end if;

  update public.ocr_batches
  set status = terminal_status::public.processing_status,
      last_error_code = error_code,
      last_error_message = safe_error_message,
      next_retry_at = case
        when terminal_status in ('retryable', 'blocked_quota') then retry_at
        else null
      end,
      finished_at = case when terminal_status in ('ready', 'failed') then finished_at else null end
  where id = target_batch_id and user_id = current_user_id;
  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

drop function if exists public.claim_ocr_job(uuid, text, timestamptz, integer);

revoke execute on function public.claim_ocr_job(uuid, text, timestamptz) from public, anon;
grant execute on function public.claim_ocr_job(uuid, text, timestamptz) to authenticated;
revoke execute on function public.register_ocr_batch(
  uuid, text, uuid[], integer[], bigint, bigint, integer, uuid, text, integer, timestamptz
) from public, anon;
grant execute on function public.register_ocr_batch(
  uuid, text, uuid[], integer[], bigint, bigint, integer, uuid, text, integer, timestamptz
) to authenticated;
revoke execute on function public.record_ocr_batch_call(uuid, integer, timestamptz) from public, anon;
grant execute on function public.record_ocr_batch_call(uuid, integer, timestamptz) to authenticated;
revoke execute on function public.finish_ocr_batch(uuid, text, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.finish_ocr_batch(uuid, text, text, text, timestamptz, timestamptz)
  to authenticated;

-- Transitional Supabase Storage may hold a provider-sized original while Drive-first migration completes.
-- This is not an application-level PDF limit; larger originals must use resumable Drive upload.
update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
where id = 'documents';
