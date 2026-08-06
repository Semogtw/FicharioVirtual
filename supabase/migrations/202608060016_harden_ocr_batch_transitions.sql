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
  if current_user_id is null
    or not (select public.is_authorized_user())
    or attempted_pages < 1
    or attempted_pages > 1000
  then
    return false;
  end if;

  update public.ocr_batches
  set status = 'processing',
      attempt_count = attempt_count + attempted_pages,
      provider_call_count = provider_call_count + 1,
      started_at = coalesce(started_at, called_at),
      finished_at = null,
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
  current_batch record;
  normalized_retry_at timestamptz;
begin
  if current_user_id is null
    or not (select public.is_authorized_user())
    or terminal_status not in ('ready', 'retryable', 'blocked_quota', 'failed')
    or (error_code is not null and error_code !~ '^[a-z0-9_]{1,64}$')
    or (safe_error_message is not null and char_length(safe_error_message) > 500)
    or (terminal_status in ('retryable', 'blocked_quota') and retry_at is null)
    or (terminal_status in ('ready', 'failed') and retry_at is not null)
  then
    return false;
  end if;

  normalized_retry_at := case
    when terminal_status in ('retryable', 'blocked_quota') then retry_at
    else null
  end;

  select status, last_error_code, last_error_message, next_retry_at, finished_at
  into current_batch
  from public.ocr_batches
  where id = target_batch_id and user_id = current_user_id
  for update;

  if not found then return false; end if;

  if current_batch.status::text = terminal_status then
    return current_batch.last_error_code is not distinct from error_code
      and current_batch.last_error_message is not distinct from safe_error_message
      and current_batch.next_retry_at is not distinct from normalized_retry_at;
  end if;

  if current_batch.status in ('ready', 'failed') then return false; end if;

  update public.ocr_batches
  set status = terminal_status::public.processing_status,
      last_error_code = error_code,
      last_error_message = safe_error_message,
      next_retry_at = normalized_retry_at,
      finished_at = case
        when terminal_status in ('ready', 'failed') then finished_at
        else null
      end
  where id = target_batch_id and user_id = current_user_id;

  return true;
end;
$$;

revoke execute on function public.record_ocr_batch_call(uuid, integer, timestamptz)
  from public, anon;
grant execute on function public.record_ocr_batch_call(uuid, integer, timestamptz)
  to authenticated;
revoke execute on function public.finish_ocr_batch(uuid, text, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.finish_ocr_batch(uuid, text, text, text, timestamptz, timestamptz)
  to authenticated;
