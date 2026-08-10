-- Semantic provider telemetry stores operational metadata only.
-- Never persist prompts, source text, query text, embeddings, API keys, signed URLs
-- or provider error bodies in this table.

create table public.semantic_provider_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  model text not null check (char_length(model) between 1 and 200),
  operation text not null check (operation in ('document_embedding', 'query_embedding')),
  surface text not null check (surface in ('coverage', 'search', 'indexer')),
  status text not null check (status in ('success', 'error')),
  safe_error_code text check (
    safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  http_status integer check (http_status is null or http_status between 100 and 599),
  input_count integer not null check (input_count between 1 and 64),
  input_characters bigint not null check (input_characters >= 0),
  input_bytes bigint not null check (input_bytes >= 0),
  output_dimensions integer not null check (output_dimensions between 128 and 3072),
  latency_ms integer not null check (latency_ms between 0 and 3600000),
  created_at timestamptz not null default timezone('utc', now()),
  constraint semantic_provider_usage_status_error_consistent check (
    (status = 'success' and safe_error_code is null and http_status is null)
    or status = 'error'
  )
);

create index semantic_provider_usage_user_created_idx
  on public.semantic_provider_usage_events (user_id, created_at desc);
create index semantic_provider_usage_user_operation_idx
  on public.semantic_provider_usage_events (user_id, operation, created_at desc);
create index semantic_provider_usage_model_operation_idx
  on public.semantic_provider_usage_events (model, operation, created_at desc);

alter table public.semantic_provider_usage_events enable row level security;
alter table public.semantic_provider_usage_events force row level security;

create policy "Users can read their semantic provider telemetry"
  on public.semantic_provider_usage_events
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_authorized_user())
  );

revoke all on table public.semantic_provider_usage_events from public, anon, authenticated;
grant select on table public.semantic_provider_usage_events to authenticated;
grant all on table public.semantic_provider_usage_events to service_role;

create or replace function public.record_semantic_provider_usage(
  target_event_id uuid,
  target_provider text,
  target_model text,
  target_operation text,
  target_surface text,
  terminal_status text,
  target_safe_error_code text,
  target_http_status integer,
  target_input_count integer,
  target_input_characters bigint,
  target_input_bytes bigint,
  target_output_dimensions integer,
  target_latency_ms integer,
  recorded_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    return false;
  end if;

  if target_event_id is null
    or target_provider is null
    or target_provider !~ '^[a-z][a-z0-9_-]{1,63}$'
    or target_model is null
    or char_length(target_model) not between 1 and 200
    or target_operation not in ('document_embedding', 'query_embedding')
    or target_surface not in ('coverage', 'search', 'indexer')
    or terminal_status not in ('success', 'error')
    or (target_safe_error_code is not null and target_safe_error_code !~ '^[a-z0-9_]{1,64}$')
    or (target_http_status is not null and target_http_status not between 100 and 599)
    or target_input_count not between 1 and 64
    or target_input_characters < 0
    or target_input_bytes < 0
    or target_output_dimensions not between 128 and 3072
    or target_latency_ms not between 0 and 3600000
    or recorded_at is null
    or (terminal_status = 'success' and (target_safe_error_code is not null or target_http_status is not null))
  then
    return false;
  end if;

  insert into public.semantic_provider_usage_events (
    id,
    user_id,
    provider,
    model,
    operation,
    surface,
    status,
    safe_error_code,
    http_status,
    input_count,
    input_characters,
    input_bytes,
    output_dimensions,
    latency_ms,
    created_at
  ) values (
    target_event_id,
    current_user_id,
    target_provider,
    target_model,
    target_operation,
    target_surface,
    terminal_status,
    target_safe_error_code,
    target_http_status,
    target_input_count,
    target_input_characters,
    target_input_bytes,
    target_output_dimensions,
    target_latency_ms,
    recorded_at
  )
  on conflict (id) do nothing;

  return true;
end;
$$;

revoke execute on function public.record_semantic_provider_usage(
  uuid, text, text, text, text, text, text, integer,
  integer, bigint, bigint, integer, integer, timestamptz
) from public, anon;
grant execute on function public.record_semantic_provider_usage(
  uuid, text, text, text, text, text, text, integer,
  integer, bigint, bigint, integer, integer, timestamptz
) to authenticated;

create or replace function public.semantic_provider_usage_summary(
  lookback_days integer default 30
)
returns table (
  operation text,
  surface text,
  model text,
  request_count bigint,
  success_count bigint,
  error_count bigint,
  rate_limited_count bigint,
  input_count bigint,
  input_characters bigint,
  input_bytes bigint,
  average_latency_ms double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.operation,
    e.surface,
    e.model,
    count(*)::bigint as request_count,
    count(*) filter (where e.status = 'success')::bigint as success_count,
    count(*) filter (where e.status = 'error')::bigint as error_count,
    count(*) filter (
      where e.http_status = 429 or e.safe_error_code = 'rate_limited'
    )::bigint as rate_limited_count,
    coalesce(sum(e.input_count), 0)::bigint as input_count,
    coalesce(sum(e.input_characters), 0)::bigint as input_characters,
    coalesce(sum(e.input_bytes), 0)::bigint as input_bytes,
    coalesce(avg(e.latency_ms), 0)::double precision as average_latency_ms
  from public.semantic_provider_usage_events e
  where e.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and lookback_days between 1 and 365
    and e.created_at >= timezone('utc', now()) - make_interval(days => lookback_days)
  group by e.operation, e.surface, e.model
  order by e.operation, e.surface, e.model;
$$;

revoke execute on function public.semantic_provider_usage_summary(integer) from public, anon;
grant execute on function public.semantic_provider_usage_summary(integer) to authenticated;
