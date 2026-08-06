create or replace function public.positive_integer_array(input_values integer[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(input_values) > 0
    and coalesce((select bool_and(item_value > 0) from unnest(input_values) item_value), false);
$$;

alter table public.ocr_batches
  add constraint ocr_batches_positive_page_numbers
  check (public.positive_integer_array(page_numbers));

revoke execute on function public.positive_integer_array(integer[]) from public, anon, authenticated;

-- Batch manifests are created and mutated only through validated RPCs.
revoke insert, update, delete on table public.ocr_batches from authenticated;
grant select on table public.ocr_batches to authenticated;

create or replace function public.get_usage_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with current_usage as (
    select
      coalesce(u.ocr_pages, 0) as ocr_pages,
      coalesce(u.ocr_batches, 0) as ocr_batches,
      coalesce(u.ocr_calls, 0) as ocr_calls,
      coalesce(u.ocr_attempts, 0) as ocr_attempts,
      coalesce(u.quota_errors, 0) as quota_errors
    from (select 1) seed
    left join public.usage_daily u
      on u.user_id = (select auth.uid())
     and u.usage_date = (timezone('utc', now()))::date
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'today', jsonb_build_object(
      'date', (timezone('utc', now()))::date,
      'ocrPages', current_usage.ocr_pages,
      'ocrBatches', current_usage.ocr_batches,
      'ocrCalls', current_usage.ocr_calls,
      'ocrAttempts', current_usage.ocr_attempts,
      'averageBatchSize', case
        when current_usage.ocr_calls = 0 then 0
        else round(current_usage.ocr_pages::numeric / current_usage.ocr_calls, 2)
      end,
      'quotaErrors', current_usage.quota_errors
    ),
    'totals', jsonb_build_object(
      'notebooks', (
        select count(*) from public.notebooks n
        where n.user_id = (select auth.uid())
      ),
      'documents', (
        select count(*) from public.documents d
        where d.user_id = (select auth.uid())
      ),
      'pages', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
      ),
      'pendingPages', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
          and p.status in ('pending', 'processing', 'retryable', 'blocked_quota')
      ),
      'blockedQuotaPages', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
          and p.status = 'blocked_quota'
      ),
      'reviewPages', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
          and p.status = 'needs_review'
      ),
      'failedPages', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
          and p.status = 'failed'
      ),
      'manualReviews', (
        select count(*) from public.pages p
        where p.user_id = (select auth.uid())
          and p.was_manually_reviewed = true
      )
    ),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', u.usage_date,
          'ocrPages', u.ocr_pages,
          'ocrBatches', u.ocr_batches,
          'ocrCalls', u.ocr_calls,
          'ocrAttempts', u.ocr_attempts,
          'averageBatchSize', case
            when u.ocr_calls = 0 then 0
            else round(u.ocr_pages::numeric / u.ocr_calls, 2)
          end,
          'quotaErrors', u.quota_errors
        ) order by u.usage_date
      )
      from public.usage_daily u
      where u.user_id = (select auth.uid())
        and u.usage_date >= (timezone('utc', now()))::date - 29
    ), '[]'::jsonb)
  )
  from current_usage
  where (select public.is_authorized_user());
$$;

revoke execute on function public.get_usage_overview() from public, anon;
grant execute on function public.get_usage_overview() to authenticated;