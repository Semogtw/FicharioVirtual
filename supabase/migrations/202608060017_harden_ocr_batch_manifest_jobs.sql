alter table public.ocr_jobs
  drop constraint ocr_jobs_batch_id_fkey;

alter table public.ocr_jobs
  add constraint ocr_jobs_batch_id_fkey
  foreign key (batch_id)
  references public.ocr_batches(id)
  on delete restrict;

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
  new_batch_id uuid := gen_random_uuid();
  item_count integer := cardinality(target_page_ids);
  matched_pages integer;
  matched_jobs integer;
  linked_jobs integer;
  unsafe_jobs integer;
  prior_parent_count integer;
  prior_max_split_depth integer := -1;
  inferred_parent_batch_id uuid;
  parent_split_depth integer;
  effective_parent_batch_id uuid := target_parent_batch_id;
  effective_split_depth integer := target_split_depth;
begin
  if current_user_id is null
    or not (select public.is_authorized_user())
    or target_route not in ('gemini', 'desktop')
    or item_count < 1
    or item_count > 1000
    or cardinality(target_page_numbers) <> item_count
    or (
      select count(distinct page_id)
      from unnest(target_page_ids) as requested_ids(page_id)
    ) <> item_count
    or (
      select count(distinct page_number)
      from unnest(target_page_numbers) as requested_numbers(page_number)
    ) <> item_count
    or exists (
      select 1
      from unnest(target_page_numbers) as requested_numbers(page_number)
      where page_number < 1
    )
    or target_source_bytes < 0
    or target_derived_bytes < 0
    or target_split_depth < 0
    or target_split_depth > 32
    or target_prompt_version < 1
    or target_prompt_version > 10000
    or target_model !~ '^[A-Za-z0-9._-]{3,128}$'
  then
    return null;
  end if;

  select count(*)
  into matched_pages
  from unnest(target_page_ids, target_page_numbers) as requested(page_id, page_number)
  join public.pages p
    on p.id = requested.page_id
   and p.page_number = requested.page_number
   and p.user_id = current_user_id
   and p.document_id = target_document_id;
  if matched_pages <> item_count then return null; end if;

  perform 1
  from public.ocr_jobs j
  where j.user_id = current_user_id
    and j.page_id = any(target_page_ids)
  order by j.page_id
  for update;

  select count(*)
  into matched_jobs
  from public.ocr_jobs j
  where j.user_id = current_user_id
    and j.page_id = any(target_page_ids);
  if matched_jobs <> item_count then return null; end if;

  select count(*)
  into unsafe_jobs
  from public.ocr_jobs j
  join public.ocr_batches b on b.id = j.batch_id
  where j.user_id = current_user_id
    and j.page_id = any(target_page_ids)
    and (
      b.user_id <> current_user_id
      or b.document_id <> target_document_id
      or b.status not in ('retryable', 'blocked_quota')
    );
  if unsafe_jobs > 0 then return null; end if;

  select
    count(distinct j.batch_id),
    (array_agg(distinct j.batch_id) filter (where j.batch_id is not null))[1],
    coalesce(max(b.split_depth), -1)
  into prior_parent_count, inferred_parent_batch_id, prior_max_split_depth
  from public.ocr_jobs j
  left join public.ocr_batches b on b.id = j.batch_id
  where j.user_id = current_user_id
    and j.page_id = any(target_page_ids);

  if target_parent_batch_id is not null then
    select b.split_depth
    into parent_split_depth
    from public.ocr_batches b
    where b.id = target_parent_batch_id
      and b.user_id = current_user_id
      and b.document_id = target_document_id
      and b.status in ('retryable', 'blocked_quota');
    if not found then return null; end if;

    if exists (
      select 1
      from public.ocr_jobs j
      where j.user_id = current_user_id
        and j.page_id = any(target_page_ids)
        and j.batch_id is not null
        and j.batch_id <> target_parent_batch_id
    ) then
      return null;
    end if;

    effective_split_depth := greatest(target_split_depth, parent_split_depth + 1);
  elsif prior_parent_count = 1 then
    effective_parent_batch_id := inferred_parent_batch_id;
    effective_split_depth := greatest(target_split_depth, prior_max_split_depth + 1);
  elsif prior_parent_count > 1 then
    effective_parent_batch_id := null;
    effective_split_depth := greatest(target_split_depth, prior_max_split_depth + 1);
  else
    effective_parent_batch_id := null;
  end if;

  if effective_split_depth > 32 then return null; end if;

  insert into public.ocr_batches (
    id, user_id, document_id, parent_batch_id, route, status,
    page_ids, page_numbers, source_bytes, derived_bytes, split_depth,
    model, prompt_version, created_at, updated_at
  ) values (
    new_batch_id, current_user_id, target_document_id, effective_parent_batch_id,
    target_route, 'pending', target_page_ids, target_page_numbers,
    target_source_bytes, target_derived_bytes, effective_split_depth,
    target_model, target_prompt_version, registered_at, registered_at
  );

  update public.ocr_jobs j
  set batch_id = new_batch_id,
      batch_ordinal = ordered.ordinality,
      route = target_route,
      updated_at = registered_at
  from unnest(target_page_ids) with ordinality as ordered(page_id, ordinality)
  where j.user_id = current_user_id
    and j.page_id = ordered.page_id;
  get diagnostics linked_jobs = row_count;

  if linked_jobs <> item_count then
    raise exception 'OCR batch manifest linkage changed during registration'
      using errcode = '40001';
  end if;

  insert into public.usage_daily (user_id, usage_date, ocr_batches, updated_at)
  values (current_user_id, (registered_at at time zone 'utc')::date, 1, registered_at)
  on conflict (user_id, usage_date) do update
  set ocr_batches = public.usage_daily.ocr_batches + 1,
      updated_at = excluded.updated_at;

  return new_batch_id;
end;
$$;

revoke execute on function public.register_ocr_batch(
  uuid, text, uuid[], integer[], bigint, bigint, integer, uuid, text, integer, timestamptz
) from public, anon;
grant execute on function public.register_ocr_batch(
  uuid, text, uuid[], integer[], bigint, bigint, integer, uuid, text, integer, timestamptz
) to authenticated;
