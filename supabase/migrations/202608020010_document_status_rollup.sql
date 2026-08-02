create or replace function public.refresh_document_status_from_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_document_id uuid := coalesce(new.document_id, old.document_id);
  target_user_id uuid := coalesce(new.user_id, old.user_id);
  total_pages integer;
  ready_pages integer;
  review_pages integer;
  active_pages integer;
  failed_pages integer;
  next_status public.document_status;
begin
  select
    count(*)::integer,
    count(*) filter (where status = 'ready')::integer,
    count(*) filter (where status = 'needs_review')::integer,
    count(*) filter (where status in ('pending', 'processing', 'retryable', 'blocked_quota'))::integer,
    count(*) filter (where status = 'failed')::integer
  into total_pages, ready_pages, review_pages, active_pages, failed_pages
  from public.pages
  where document_id = target_document_id
    and user_id = target_user_id;

  if total_pages = 0 then return coalesce(new, old); end if;

  next_status := case
    when active_pages > 0 and ready_pages + review_pages > 0
      then 'partially_ready'::public.document_status
    when active_pages > 0
      then 'processing'::public.document_status
    when failed_pages = total_pages
      then 'failed'::public.document_status
    when failed_pages > 0
      then 'partially_ready'::public.document_status
    when review_pages > 0
      then 'needs_review'::public.document_status
    else 'ready'::public.document_status
  end;

  update public.documents
  set status = next_status,
      page_count = total_pages
  where id = target_document_id
    and user_id = target_user_id
    and (status is distinct from next_status or page_count is distinct from total_pages);

  return coalesce(new, old);
end;
$$;

create trigger pages_roll_up_document_status
  after insert or delete or update of status
  on public.pages
  for each row execute function public.refresh_document_status_from_pages();

revoke execute on function public.refresh_document_status_from_pages() from public, anon, authenticated;

create or replace function public.fail_ocr_job(
  target_page_id uuid,
  error_code text,
  safe_error_message text,
  retryable boolean,
  failed_at timestamptz,
  retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
  target_status public.processing_status;
begin
  if current_user_id is null
    or error_code !~ '^[a-z0-9_]{1,64}$'
    or safe_error_message is null
    or char_length(safe_error_message) > 500
    or (retryable and (retry_at is null or retry_at <= failed_at))
  then
    return false;
  end if;

  select id into target_job_id
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
    and status = 'processing'
  for update;

  if not found then return false; end if;
  target_status := case
    when retryable then 'retryable'::public.processing_status
    else 'failed'::public.processing_status
  end;

  update public.ocr_jobs
  set status = target_status,
      last_error_code = error_code,
      last_error_message = safe_error_message,
      next_retry_at = case when retryable then retry_at else null end,
      finished_at = case when retryable then null else failed_at end
  where id = target_job_id;

  update public.pages
  set status = target_status
  where id = target_page_id
    and user_id = current_user_id;

  return true;
end;
$$;
