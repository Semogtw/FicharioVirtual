create or replace function public.get_usage_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'today', jsonb_build_object(
      'date', (timezone('utc', now()))::date,
      'ocrPages', coalesce((
        select u.ocr_pages
        from public.usage_daily u
        where u.user_id = (select auth.uid())
          and u.usage_date = (timezone('utc', now()))::date
      ), 0),
      'quotaErrors', coalesce((
        select u.quota_errors
        from public.usage_daily u
        where u.user_id = (select auth.uid())
          and u.usage_date = (timezone('utc', now()))::date
      ), 0)
    ),
    'totals', jsonb_build_object(
      'notebooks', (
        select count(*)
        from public.notebooks n
        where n.user_id = (select auth.uid())
      ),
      'documents', (
        select count(*)
        from public.documents d
        where d.user_id = (select auth.uid())
      ),
      'pages', (
        select count(*)
        from public.pages p
        where p.user_id = (select auth.uid())
      ),
      'pendingPages', (
        select count(*)
        from public.pages p
        where p.user_id = (select auth.uid())
          and p.status in ('pending', 'processing', 'retryable', 'blocked_quota')
      ),
      'reviewPages', (
        select count(*)
        from public.pages p
        where p.user_id = (select auth.uid())
          and p.status = 'needs_review'
      ),
      'failedPages', (
        select count(*)
        from public.pages p
        where p.user_id = (select auth.uid())
          and p.status = 'failed'
      ),
      'manualReviews', (
        select count(*)
        from public.pages p
        where p.user_id = (select auth.uid())
          and p.was_manually_reviewed = true
      )
    ),
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', u.usage_date,
          'ocrPages', u.ocr_pages,
          'quotaErrors', u.quota_errors
        ) order by u.usage_date
      )
      from public.usage_daily u
      where u.user_id = (select auth.uid())
        and u.usage_date >= (timezone('utc', now()))::date - 29
    ), '[]'::jsonb)
  )
  where (select public.is_authorized_user());
$$;

revoke execute on function public.get_usage_overview() from public, anon;
grant execute on function public.get_usage_overview() to authenticated;
