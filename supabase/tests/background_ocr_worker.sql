begin;

select plan(15);

select is(
  has_function_privilege('anon', 'public.recover_background_stale_ocr_jobs()', 'EXECUTE'),
  false,
  'anon cannot recover background OCR jobs'
);
select is(
  has_function_privilege('authenticated', 'public.recover_background_stale_ocr_jobs()', 'EXECUTE'),
  false,
  'authenticated users cannot recover background OCR jobs directly'
);
select is(
  has_function_privilege('service_role', 'public.recover_background_stale_ocr_jobs()', 'EXECUTE'),
  true,
  'service role can recover background OCR jobs'
);

select is(
  has_function_privilege('anon', 'public.list_background_gemini_ocr_candidates(integer)', 'EXECUTE'),
  false,
  'anon cannot list background Gemini candidates'
);
select is(
  has_function_privilege('authenticated', 'public.list_background_gemini_ocr_candidates(integer)', 'EXECUTE'),
  false,
  'authenticated users cannot list background Gemini candidates directly'
);
select is(
  has_function_privilege('service_role', 'public.list_background_gemini_ocr_candidates(integer)', 'EXECUTE'),
  true,
  'service role can list background Gemini candidates'
);

select is(
  has_function_privilege('anon', 'public.background_ocr_as_user(uuid,text,jsonb)', 'EXECUTE'),
  false,
  'anon cannot use the background OCR dispatcher'
);
select is(
  has_function_privilege('authenticated', 'public.background_ocr_as_user(uuid,text,jsonb)', 'EXECUTE'),
  false,
  'authenticated users cannot impersonate background OCR workers'
);
select is(
  has_function_privilege('service_role', 'public.background_ocr_as_user(uuid,text,jsonb)', 'EXECUTE'),
  true,
  'service role can use the constrained background OCR dispatcher'
);

select is(
  has_function_privilege('anon', 'public.get_document_ocr_summary(uuid)', 'EXECUTE'),
  false,
  'anon cannot inspect document OCR summaries'
);
select is(
  has_function_privilege('authenticated', 'public.get_document_ocr_summary(uuid)', 'EXECUTE'),
  true,
  'authenticated owners can inspect document OCR summaries'
);
select is(
  has_function_privilege('service_role', 'public.get_document_ocr_summary(uuid)', 'EXECUTE'),
  true,
  'service role can inspect document OCR summaries'
);

select is(
  (select count(*)::integer from cron.job where jobname = 'fichario-background-ocr-wakeup'),
  1,
  'background OCR wake-up cron is installed exactly once'
);

select is(
  (select schedule from cron.job where jobname = 'fichario-background-ocr-wakeup'),
  '* * * * *',
  'background OCR due-work wake-up runs every minute'
);

select ok(
  (
    select command like '%vault.decrypted_secrets%'
      and command like '%ocr_background_worker_key%'
      and command like '%due_work.has_due%'
      and command like '%cron-due-work%'
      and command not like '%SUPABASE_SERVICE_ROLE_KEY%'
    from cron.job
    where jobname = 'fichario-background-ocr-wakeup'
  ),
  'cron resolves its worker credential from Vault and only wakes for due work'
);

select * from finish();
rollback;
