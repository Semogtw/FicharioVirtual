create or replace function public.recover_stale_ocr_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  recovery_at timestamptz := timezone('utc', now());
  recovered_page_ids uuid[] := '{}'::uuid[];
  recovered_batch_ids uuid[] := '{}'::uuid[];
  recovered_count integer := 0;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    return 0;
  end if;

  with recovered as (
    update public.ocr_jobs
    set status = 'retryable',
        last_error_code = 'stale_processing_claim',
        last_error_message = 'O processamento anterior foi interrompido e pode ser retomado.',
        next_retry_at = recovery_at,
        started_at = null,
        finished_at = null
    where user_id = current_user_id
      and status = 'processing'
      and started_at is not null
      and started_at <= recovery_at - interval '15 minutes'
    returning page_id, batch_id
  )
  select
    coalesce(array_agg(distinct page_id), '{}'::uuid[]),
    coalesce(
      array_agg(distinct batch_id) filter (where batch_id is not null),
      '{}'::uuid[]
    )
  into recovered_page_ids, recovered_batch_ids
  from recovered;

  recovered_count := cardinality(recovered_page_ids);
  if recovered_count = 0 then
    return 0;
  end if;

  update public.pages
  set status = 'retryable'
  where user_id = current_user_id
    and id = any(recovered_page_ids)
    and status = 'processing';

  if cardinality(recovered_batch_ids) > 0 then
    update public.ocr_batches
    set status = 'retryable',
        last_error_code = 'stale_processing_claim',
        last_error_message = 'O processamento anterior foi interrompido e pode ser retomado.',
        next_retry_at = recovery_at,
        started_at = null,
        finished_at = null
    where user_id = current_user_id
      and id = any(recovered_batch_ids)
      and status = 'processing';
  end if;

  return recovered_count;
end;
$$;

revoke execute on function public.recover_stale_ocr_jobs() from public, anon;
grant execute on function public.recover_stale_ocr_jobs() to authenticated;
