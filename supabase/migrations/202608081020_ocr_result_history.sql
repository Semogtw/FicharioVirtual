alter table public.pages
  add column accepted_ocr_result_id uuid;

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pages'::regclass
       and conname = 'pages_id_user_id_key'
       and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (id, user_id)'
  ) then
    null;
  elsif exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pages'::regclass
       and conname = 'pages_id_user_id_key'
  ) then
    raise exception 'pages_id_user_id_key exists with an incompatible definition';
  else
    alter table public.pages
      add constraint pages_id_user_id_key unique (id, user_id);
  end if;
end;
$$;

create table public.ocr_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null,
  ocr_job_id uuid not null unique references public.ocr_jobs(id) on delete cascade,
  provider text not null check (
    provider in ('gemini', 'local')
  ),
  model text not null check (char_length(model) between 1 and 200),
  raw_text text not null,
  corrected_text text,
  content_type text not null default 'unknown' check (char_length(content_type) between 1 and 64),
  mean_confidence numeric check (mean_confidence is null or mean_confidence between 0 and 1),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, page_id, user_id),
  foreign key (page_id, user_id)
    references public.pages(id, user_id)
    on delete cascade
);

alter table public.ocr_results enable row level security;

create policy "Users can read their OCR result history"
  on public.ocr_results
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.ocr_results from public, anon, authenticated;
grant select on public.ocr_results to authenticated;
revoke insert, update, delete on public.ocr_results from authenticated;
grant all on public.ocr_results to service_role;

insert into public.ocr_results (
  user_id,
  page_id,
  ocr_job_id,
  provider,
  model,
  raw_text,
  corrected_text,
  content_type,
  mean_confidence,
  warnings,
  metadata,
  created_at
)
select
  page.user_id,
  page.id,
  job.id,
  job.provider::text,
  coalesce(nullif(job.model, ''), 'unknown'),
  page.ocr_raw_text,
  page.corrected_text,
  'unknown',
  null,
  coalesce(page.warnings, '[]'::jsonb),
  jsonb_build_object(
    'source', 'migration_backfill',
    'promptVersion', job.prompt_version,
    'finishedAt', job.finished_at
  ),
  coalesce(job.finished_at, timezone('utc', now()))
from public.pages as page
join public.ocr_jobs as job
  on job.page_id = page.id
 and job.user_id = page.user_id
where page.extraction_source = 'ocr'
  and page.ocr_raw_text is not null
  and job.status = 'ready'
on conflict (ocr_job_id) do nothing;

update public.pages as page
   set accepted_ocr_result_id = result.id
  from public.ocr_results as result
 where result.page_id = page.id
   and result.user_id = page.user_id
   and page.accepted_ocr_result_id is null;

alter table public.pages
  add constraint pages_accepted_ocr_result_owner_fkey
  foreign key (accepted_ocr_result_id, id, user_id)
  references public.ocr_results(id, page_id, user_id)
  deferrable initially deferred;

alter function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz)
  rename to complete_ocr_job_page_summary_v1;

revoke execute on function public.complete_ocr_job_page_summary_v1(uuid, text, jsonb, public.page_status, timestamptz)
from public, anon, authenticated;
grant execute on function public.complete_ocr_job_page_summary_v1(uuid, text, jsonb, public.page_status, timestamptz)
to service_role;

create or replace function public.complete_ocr_job(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status public.page_status,
  completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_job public.ocr_jobs%rowtype;
  current_page public.pages%rowtype;
  persisted_result public.ocr_results%rowtype;
  persisted_result_id uuid;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  begin
    perform public.complete_ocr_job_page_summary_v1(
      target_page_id,
      extracted_text,
      extraction_warnings,
      terminal_status,
      completed_at
    );
  exception
    when sqlstate '22023' then
      select result.*
        into persisted_result
        from public.ocr_results as result
       where result.page_id = target_page_id
         and result.user_id = current_user_id;

      if found then
        raise exception using
          errcode = '22023',
          message = 'OCR completion conflicts with the persisted result';
      end if;
      raise;
  end;

  select job.*
    into current_job
    from public.ocr_jobs as job
   where job.page_id = target_page_id
     and job.user_id = current_user_id
   for update;

  if not found or current_job.status <> 'ready' then
    raise exception using errcode = '55000', message = 'OCR job is not ready after completion';
  end if;

  select page.*
    into current_page
    from public.pages as page
   where page.id = target_page_id
     and page.user_id = current_user_id
   for update;

  if not found
    or current_page.status <> terminal_status
    or current_page.ocr_raw_text is distinct from extracted_text
    or current_page.warnings is distinct from extraction_warnings
    or current_page.extraction_source <> 'ocr' then
    raise exception using errcode = '22023', message = 'OCR completion conflicts with the persisted result';
  end if;

  insert into public.ocr_results (
    user_id,
    page_id,
    ocr_job_id,
    provider,
    model,
    raw_text,
    corrected_text,
    content_type,
    mean_confidence,
    warnings,
    metadata,
    created_at
  ) values (
    current_user_id,
    target_page_id,
    current_job.id,
    current_job.provider::text,
    coalesce(nullif(current_job.model, ''), 'unknown'),
    extracted_text,
    null,
    'unknown',
    null,
    extraction_warnings,
    jsonb_build_object(
      'source', 'complete_ocr_job',
      'promptVersion', current_job.prompt_version,
      'ocrBatchId', current_job.batch_id,
      'finishedAt', current_job.finished_at
    ),
    coalesce(current_job.finished_at, completed_at, timezone('utc', now()))
  )
  on conflict (ocr_job_id) do nothing
  returning id into persisted_result_id;

  if persisted_result_id is null then
    select result.*
      into persisted_result
      from public.ocr_results as result
     where result.ocr_job_id = current_job.id
       and result.page_id = target_page_id
       and result.user_id = current_user_id;

    if not found
      or persisted_result.provider <> current_job.provider::text
      or persisted_result.model <> coalesce(nullif(current_job.model, ''), 'unknown')
      or persisted_result.raw_text is distinct from extracted_text
      or persisted_result.warnings is distinct from extraction_warnings then
      raise exception using errcode = '22023', message = 'OCR completion conflicts with the persisted result';
    end if;

    persisted_result_id := persisted_result.id;
  end if;

  update public.pages
     set accepted_ocr_result_id = persisted_result_id
   where id = target_page_id
     and user_id = current_user_id
     and (
       accepted_ocr_result_id is null
       or accepted_ocr_result_id = persisted_result_id
     );

  if not found then
    raise exception using errcode = '22023', message = 'OCR completion conflicts with the persisted result';
  end if;
end;
$$;

revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from public;
revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from anon;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) to authenticated;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) to service_role;
