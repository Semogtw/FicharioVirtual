begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  pg_get_functiondef(
    'public.fail_ocr_job(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure
  ) like '%target_job_status public.ocr_status%'
  and pg_get_functiondef(
    'public.fail_ocr_job(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure
  ) like '%target_page_status public.page_status%',
  'OCR failure RPC uses the split job and page status enums'
);

select ok(
  pg_get_functiondef(
    'public.fail_ocr_job(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure
  ) not like '%target_status public.processing_status%',
  'OCR failure RPC no longer assigns the legacy processing_status enum to OCR jobs'
);

select * from finish();
rollback;
