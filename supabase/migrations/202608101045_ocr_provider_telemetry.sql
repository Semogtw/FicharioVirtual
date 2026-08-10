-- Provider telemetry is operational metadata only. Never persist prompts, OCR text,
-- image bytes, signed URLs, API keys or provider error bodies here.

create table public.ocr_provider_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  ocr_batch_id uuid,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  model text not null check (char_length(model) between 1 and 200),
  provider_model_version text check (
    provider_model_version is null or char_length(provider_model_version) between 1 and 200
  ),
  prompt_version integer not null check (prompt_version between 1 and 10000),
  document_kind public.document_kind not null,
  status text not null check (status in ('success', 'error')),
  safe_error_code text check (
    safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  page_count integer not null check (page_count between 1 and 1000),
  source_bytes bigint not null check (source_bytes >= 0),
  latency_ms integer not null check (latency_ms between 0 and 3600000),
  prompt_token_count bigint check (prompt_token_count is null or prompt_token_count >= 0),
  cached_content_token_count bigint check (
    cached_content_token_count is null or cached_content_token_count >= 0
  ),
  candidates_token_count bigint check (
    candidates_token_count is null or candidates_token_count >= 0
  ),
  tool_use_prompt_token_count bigint check (
    tool_use_prompt_token_count is null or tool_use_prompt_token_count >= 0
  ),
  thoughts_token_count bigint check (thoughts_token_count is null or thoughts_token_count >= 0),
  total_token_count bigint check (total_token_count is null or total_token_count >= 0),
  service_tier text check (
    service_tier is null or service_tier ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  provider_response_id text check (
    provider_response_id is null or char_length(provider_response_id) between 1 and 256
  ),
  usage_details jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_details) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  foreign key (ocr_batch_id, user_id)
    references public.ocr_batches(id, user_id)
    on delete restrict,
  check ((status = 'success' and safe_error_code is null) or status = 'error')
);

create table public.ocr_provider_page_metrics (
  usage_event_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  page_id uuid not null,
  page_number integer not null check (page_number >= 1),
  source_bytes bigint not null check (source_bytes >= 0),
  output_characters integer not null default 0 check (output_characters >= 0),
  warning_count integer not null default 0 check (warning_count between 0 and 1000),
  needs_review boolean not null default false,
  content_class text not null default 'unknown' check (
    content_class in (
      'unknown',
      'book_clean',
      'scan_degraded',
      'handwriting',
      'mixed',
      'table_layout',
      'math',
      'sparse'
    )
  ),
  route_reason text not null default 'primary_gemini' check (
    route_reason ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  shadow_sample boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (usage_event_id, page_id),
  foreign key (usage_event_id, user_id)
    references public.ocr_provider_usage_events(id, user_id)
    on delete cascade,
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  foreign key (page_id, user_id)
    references public.pages(id, user_id)
    on delete cascade
);

create index ocr_provider_usage_user_created_idx
  on public.ocr_provider_usage_events (user_id, created_at desc);
create index ocr_provider_usage_document_idx
  on public.ocr_provider_usage_events (document_id, created_at desc);
create index ocr_provider_usage_batch_idx
  on public.ocr_provider_usage_events (ocr_batch_id)
  where ocr_batch_id is not null;
create index ocr_provider_page_metrics_user_class_idx
  on public.ocr_provider_page_metrics (user_id, content_class, created_at desc);
create index ocr_provider_page_metrics_document_idx
  on public.ocr_provider_page_metrics (document_id, page_number);

alter table public.ocr_provider_usage_events enable row level security;
alter table public.ocr_provider_usage_events force row level security;
alter table public.ocr_provider_page_metrics enable row level security;
alter table public.ocr_provider_page_metrics force row level security;

create policy "Users can read their OCR provider telemetry"
  on public.ocr_provider_usage_events
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_authorized_user())
  );

create policy "Users can read their OCR page telemetry"
  on public.ocr_provider_page_metrics
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_authorized_user())
  );

revoke all on table public.ocr_provider_usage_events from public, anon, authenticated;
revoke all on table public.ocr_provider_page_metrics from public, anon, authenticated;
grant select on table public.ocr_provider_usage_events to authenticated;
grant select on table public.ocr_provider_page_metrics to authenticated;
grant all on table public.ocr_provider_usage_events to service_role;
grant all on table public.ocr_provider_page_metrics to service_role;

create or replace function public.record_ocr_provider_usage(
  target_event_id uuid,
  target_document_id uuid,
  target_batch_id uuid,
  target_provider text,
  target_model text,
  target_provider_model_version text,
  target_prompt_version integer,
  target_document_kind public.document_kind,
  terminal_status text,
  target_safe_error_code text,
  target_page_metrics jsonb,
  target_latency_ms integer,
  target_prompt_token_count bigint,
  target_cached_content_token_count bigint,
  target_candidates_token_count bigint,
  target_tool_use_prompt_token_count bigint,
  target_thoughts_token_count bigint,
  target_total_token_count bigint,
  target_service_tier text,
  target_provider_response_id text,
  target_usage_details jsonb,
  recorded_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  metric_count integer;
  matched_pages integer;
  total_source_bytes bigint;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    return false;
  end if;
  if target_event_id is null
    or target_document_id is null
    or target_provider is null
    or target_provider !~ '^[a-z][a-z0-9_-]{1,63}$'
    or target_model is null
    or char_length(target_model) not between 1 and 200
    or (target_provider_model_version is not null and char_length(target_provider_model_version) not between 1 and 200)
    or target_prompt_version not between 1 and 10000
    or terminal_status not in ('success', 'error')
    or (terminal_status = 'success' and target_safe_error_code is not null)
    or (target_safe_error_code is not null and target_safe_error_code !~ '^[a-z0-9_]{1,64}$')
    or target_latency_ms not between 0 and 3600000
    or target_page_metrics is null
    or jsonb_typeof(target_page_metrics) <> 'array'
    or target_usage_details is null
    or jsonb_typeof(target_usage_details) <> 'object'
    or recorded_at is null
    or (target_service_tier is not null and target_service_tier !~ '^[A-Z][A-Z0-9_]{0,63}$')
    or (target_provider_response_id is not null and char_length(target_provider_response_id) not between 1 and 256)
  then
    return false;
  end if;

  metric_count := jsonb_array_length(target_page_metrics);
  if metric_count < 1 or metric_count > 1000 then return false; end if;

  if not exists (
    select 1
      from public.documents d
     where d.id = target_document_id
       and d.user_id = current_user_id
       and d.kind = target_document_kind
  ) then
    return false;
  end if;

  if target_batch_id is not null and not exists (
    select 1
      from public.ocr_batches b
     where b.id = target_batch_id
       and b.user_id = current_user_id
       and b.document_id = target_document_id
  ) then
    return false;
  end if;

  with metrics as (
    select *
      from jsonb_to_recordset(target_page_metrics) as item(
        "pageId" uuid,
        "pageNumber" integer,
        "sourceBytes" bigint,
        "outputCharacters" integer,
        "warningCount" integer,
        "needsReview" boolean,
        "contentClass" text,
        "routeReason" text,
        "shadowSample" boolean
      )
  )
  select
    count(*),
    coalesce(sum("sourceBytes"), 0)
    into metric_count, total_source_bytes
    from metrics
   where "pageId" is not null
     and "pageNumber" >= 1
     and "sourceBytes" >= 0
     and "outputCharacters" >= 0
     and "warningCount" between 0 and 1000
     and "needsReview" is not null
     and "contentClass" in (
       'unknown', 'book_clean', 'scan_degraded', 'handwriting',
       'mixed', 'table_layout', 'math', 'sparse'
     )
     and "routeReason" ~ '^[a-z][a-z0-9_]{1,63}$'
     and "shadowSample" is not null;

  if metric_count <> jsonb_array_length(target_page_metrics) then return false; end if;

  if (
    select count(distinct item."pageId")
      from jsonb_to_recordset(target_page_metrics) as item("pageId" uuid)
  ) <> metric_count then
    return false;
  end if;

  select count(*) into matched_pages
    from jsonb_to_recordset(target_page_metrics) as item("pageId" uuid, "pageNumber" integer)
    join public.pages p
      on p.id = item."pageId"
     and p.page_number = item."pageNumber"
   where p.user_id = current_user_id
     and p.document_id = target_document_id;
  if matched_pages <> metric_count then return false; end if;

  if (target_prompt_token_count is not null and target_prompt_token_count < 0)
    or (target_cached_content_token_count is not null and target_cached_content_token_count < 0)
    or (target_candidates_token_count is not null and target_candidates_token_count < 0)
    or (target_tool_use_prompt_token_count is not null and target_tool_use_prompt_token_count < 0)
    or (target_thoughts_token_count is not null and target_thoughts_token_count < 0)
    or (target_total_token_count is not null and target_total_token_count < 0)
  then
    return false;
  end if;

  insert into public.ocr_provider_usage_events (
    id, user_id, document_id, ocr_batch_id, provider, model,
    provider_model_version, prompt_version, document_kind, status,
    safe_error_code, page_count, source_bytes, latency_ms,
    prompt_token_count, cached_content_token_count, candidates_token_count,
    tool_use_prompt_token_count, thoughts_token_count, total_token_count,
    service_tier, provider_response_id, usage_details, created_at
  ) values (
    target_event_id, current_user_id, target_document_id, target_batch_id,
    target_provider, target_model, target_provider_model_version,
    target_prompt_version, target_document_kind, terminal_status,
    target_safe_error_code, metric_count, total_source_bytes, target_latency_ms,
    target_prompt_token_count, target_cached_content_token_count,
    target_candidates_token_count, target_tool_use_prompt_token_count,
    target_thoughts_token_count, target_total_token_count, target_service_tier,
    target_provider_response_id, target_usage_details, recorded_at
  )
  on conflict (id) do nothing;

  if not found then
    return exists (
      select 1 from public.ocr_provider_usage_events e
      where e.id = target_event_id and e.user_id = current_user_id
    );
  end if;

  insert into public.ocr_provider_page_metrics (
    usage_event_id, user_id, document_id, page_id, page_number,
    source_bytes, output_characters, warning_count, needs_review,
    content_class, route_reason, shadow_sample, created_at
  )
  select
    target_event_id,
    current_user_id,
    target_document_id,
    item."pageId",
    item."pageNumber",
    item."sourceBytes",
    item."outputCharacters",
    item."warningCount",
    item."needsReview",
    item."contentClass",
    item."routeReason",
    item."shadowSample",
    recorded_at
  from jsonb_to_recordset(target_page_metrics) as item(
    "pageId" uuid,
    "pageNumber" integer,
    "sourceBytes" bigint,
    "outputCharacters" integer,
    "warningCount" integer,
    "needsReview" boolean,
    "contentClass" text,
    "routeReason" text,
    "shadowSample" boolean
  )
  on conflict (usage_event_id, page_id) do nothing;

  return true;
end;
$$;

revoke execute on function public.record_ocr_provider_usage(
  uuid, uuid, uuid, text, text, text, integer, public.document_kind,
  text, text, jsonb, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, text, text, jsonb, timestamptz
) from public, anon;
grant execute on function public.record_ocr_provider_usage(
  uuid, uuid, uuid, text, text, text, integer, public.document_kind,
  text, text, jsonb, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, text, text, jsonb, timestamptz
) to authenticated, service_role;

create or replace function public.get_ocr_telemetry_overview(window_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  start_date timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not (select public.is_authorized_user())
    or window_days not between 1 and 365
  then
    return null;
  end if;

  start_date := now() - make_interval(days => window_days - 1);

  with events as (
    select * from public.ocr_provider_usage_events e
    where e.user_id = current_user_id
      and e.created_at >= start_date
  ),
  metrics as (
    select m.* from public.ocr_provider_page_metrics m
    where m.user_id = current_user_id
      and m.created_at >= start_date
  )
  select jsonb_build_object(
    'generatedAt', timezone('utc', now()),
    'windowDays', window_days,
    'totals', jsonb_build_object(
      'requests', (select count(*) from events),
      'successfulRequests', (select count(*) from events where status = 'success'),
      'failedRequests', (select count(*) from events where status = 'error'),
      'pages', (select coalesce(sum(page_count), 0) from events),
      'sourceBytes', (select coalesce(sum(source_bytes), 0) from events),
      'promptTokens', (select coalesce(sum(prompt_token_count), 0) from events),
      'outputTokens', (select coalesce(sum(candidates_token_count), 0) from events),
      'thinkingTokens', (select coalesce(sum(thoughts_token_count), 0) from events),
      'totalTokens', (select coalesce(sum(total_token_count), 0) from events),
      'averageLatencyMs', (select coalesce(round(avg(latency_ms)), 0) from events)
    ),
    'byDocumentKind', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', grouped.document_kind,
        'requests', grouped.requests,
        'pages', grouped.pages,
        'totalTokens', grouped.total_tokens
      ) order by grouped.document_kind)
      from (
        select document_kind, count(*) as requests,
               sum(page_count) as pages,
               coalesce(sum(total_token_count), 0) as total_tokens
        from events
        group by document_kind
      ) grouped
    ), '[]'::jsonb),
    'byContentClass', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contentClass', grouped.content_class,
        'pages', grouped.pages,
        'sourceBytes', grouped.source_bytes,
        'reviewPages', grouped.review_pages,
        'averageOutputCharacters', grouped.average_output_characters
      ) order by grouped.content_class)
      from (
        select content_class,
               count(*) as pages,
               sum(source_bytes) as source_bytes,
               count(*) filter (where needs_review) as review_pages,
               round(avg(output_characters)) as average_output_characters
        from metrics
        group by content_class
      ) grouped
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', grouped.usage_date,
        'requests', grouped.requests,
        'pages', grouped.pages,
        'promptTokens', grouped.prompt_tokens,
        'outputTokens', grouped.output_tokens,
        'thinkingTokens', grouped.thinking_tokens,
        'totalTokens', grouped.total_tokens
      ) order by grouped.usage_date)
      from (
        select (created_at at time zone 'utc')::date as usage_date,
               count(*) as requests,
               sum(page_count) as pages,
               coalesce(sum(prompt_token_count), 0) as prompt_tokens,
               coalesce(sum(candidates_token_count), 0) as output_tokens,
               coalesce(sum(thoughts_token_count), 0) as thinking_tokens,
               coalesce(sum(total_token_count), 0) as total_tokens
        from events
        group by (created_at at time zone 'utc')::date
      ) grouped
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.get_ocr_telemetry_overview(integer) from public, anon;
grant execute on function public.get_ocr_telemetry_overview(integer) to authenticated;
