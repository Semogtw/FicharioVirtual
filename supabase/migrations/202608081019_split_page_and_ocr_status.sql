-- Pages and OCR jobs deliberately stop sharing one status enum here. The job
-- enum can then grow worker-only states (for example waiting_desktop) without
-- making those states valid for page summaries. processing_status remains in
-- use by OCR batches and as a compatibility source type for older RPC bodies.

create type public.page_status as enum (
  'pending',
  'processing',
  'ready',
  'retryable',
  'blocked_quota',
  'needs_review',
  'failed'
);

create type public.ocr_status as enum (
  'pending',
  'processing',
  'ready',
  'retryable',
  'blocked_quota',
  'needs_review',
  'failed'
);

-- The review RPC exposes the page status type, so replace it rather than
-- leaving a function signature tied to the legacy shared enum.
drop function public.list_review_pages(integer, integer);

-- Partial indexes embed enum constants and therefore cannot be reused across
-- the type change. Recreate all status indexes after converting the columns.
drop index if exists public.pages_user_status_idx;
drop index if exists public.ocr_jobs_runnable_idx;
drop index if exists public.ocr_jobs_user_status_idx;

alter table public.pages alter column status drop default;
-- UPDATE OF status is part of this trigger's dependency metadata, so the
-- trigger must be rebuilt while the column changes enum type.
drop trigger if exists pages_roll_up_document_status on public.pages;
alter table public.pages
  alter column status type public.page_status
  using status::text::public.page_status;
alter table public.pages
  alter column status set default 'pending'::public.page_status;
create trigger pages_roll_up_document_status
  after insert or delete or update of status on public.pages
  for each row execute function public.refresh_document_status_from_pages();

alter table public.ocr_jobs alter column status drop default;
alter table public.ocr_jobs
  alter column status type public.ocr_status
  using status::text::public.ocr_status;
alter table public.ocr_jobs
  alter column status set default 'pending'::public.ocr_status;

create index pages_user_status_idx
  on public.pages (user_id, status, updated_at desc);

create index ocr_jobs_runnable_idx
  on public.ocr_jobs (status, next_retry_at, created_at)
  where status in ('pending'::public.ocr_status, 'retryable'::public.ocr_status);

create index ocr_jobs_user_status_idx
  on public.ocr_jobs (user_id, status, updated_at desc);

-- Several older import/failure RPCs intentionally remain callable while this
-- schema evolves. Their PL/pgSQL bodies contain explicit processing_status
-- values, so provide one-way assignment casts into the two new domains. No
-- reverse cast is defined: worker-only OCR states must never become page/batch
-- states accidentally.
create function public.processing_status_to_page_status(value public.processing_status)
returns public.page_status
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select value::text::public.page_status
$$;

create cast (public.processing_status as public.page_status)
with function public.processing_status_to_page_status(public.processing_status)
as assignment;

create function public.processing_status_to_ocr_status(value public.processing_status)
returns public.ocr_status
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select value::text::public.ocr_status
$$;

create cast (public.processing_status as public.ocr_status)
with function public.processing_status_to_ocr_status(public.processing_status)
as assignment;

-- Result-history migration 1020 intentionally renames this typed summary
-- function before wrapping it with immutable-result persistence. Rebuild the
-- latest idempotent implementation with page_status in its signature.
drop function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz);

create function public.complete_ocr_job(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status public.page_status,
  completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_job record;
  current_page record;
begin
  if current_user_id is null
    or terminal_status not in ('ready'::public.page_status, 'needs_review'::public.page_status)
    or extracted_text is null
    or char_length(extracted_text) > 1000000
    or jsonb_typeof(extraction_warnings) <> 'array'
    or completed_at is null
  then
    return false;
  end if;

  select
    j.id as job_id,
    j.status as job_status,
    j.finished_at,
    p.status as page_status,
    p.ocr_raw_text,
    p.warnings,
    p.extraction_source
  into current_job
  from public.ocr_jobs as j
  join public.pages as p
    on p.id = j.page_id
   and p.user_id = j.user_id
  where j.page_id = target_page_id
    and j.user_id = current_user_id
  for update of j, p;

  if not found then return false; end if;

  if current_job.job_status = 'ready'::public.ocr_status then
    return current_job.page_status = terminal_status
      and current_job.ocr_raw_text is not distinct from extracted_text
      and current_job.warnings is not distinct from extraction_warnings
      and current_job.extraction_source = 'ocr'::public.extraction_source;
  end if;

  if current_job.job_status <> 'processing'::public.ocr_status then return false; end if;

  update public.pages
     set ocr_raw_text = extracted_text,
         warnings = extraction_warnings,
         extraction_source = 'ocr'::public.extraction_source,
         status = terminal_status
   where id = target_page_id
     and user_id = current_user_id;

  update public.ocr_jobs
     set status = 'ready'::public.ocr_status,
         finished_at = completed_at,
         last_error_code = null,
         last_error_message = null,
         next_retry_at = null
   where id = current_job.job_id
     and user_id = current_user_id;

  return true;
end;
$$;

revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz)
from public, anon;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz)
to authenticated;

create function public.list_review_pages(
  result_limit integer default 50,
  result_offset integer default 0
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  document_kind public.document_kind,
  page_number integer,
  page_status public.page_status,
  excerpt text,
  warnings jsonb,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recover_stale_ocr_jobs();

  return query
  select
    p.id as page_id,
    d.id as document_id,
    d.title as document_title,
    d.kind as document_kind,
    p.page_number,
    p.status as page_status,
    left(public.page_effective_text(p), 500) as excerpt,
    p.warnings,
    p.updated_at
  from public.pages as p
  join public.documents as d
    on d.id = p.document_id
   and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and p.status in (
      'needs_review'::public.page_status,
      'retryable'::public.page_status,
      'blocked_quota'::public.page_status,
      'failed'::public.page_status
    )
  order by
    case p.status
      when 'needs_review'::public.page_status then 1
      when 'retryable'::public.page_status then 2
      when 'blocked_quota'::public.page_status then 3
      else 4
    end,
    p.updated_at asc,
    p.id asc
  limit least(greatest(result_limit, 1), 100)
  offset greatest(result_offset, 0);
end;
$$;

revoke execute on function public.list_review_pages(integer, integer) from public, anon;
grant execute on function public.list_review_pages(integer, integer) to authenticated;
