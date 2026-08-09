begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  (
    select attribute.atttypid = 'public.page_status'::regtype
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid = 'public.pages'::regclass
       and attribute.attname = 'status'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ),
  'pages.status uses the page-only status domain'
);

select ok(
  (
    select attribute.atttypid = 'public.ocr_status'::regtype
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid = 'public.ocr_jobs'::regclass
       and attribute.attname = 'status'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ),
  'ocr_jobs.status uses the independently extensible OCR status domain'
);

select ok(
  (
    select attribute.atttypid = 'public.processing_status'::regtype
      from pg_catalog.pg_attribute as attribute
     where attribute.attrelid = 'public.ocr_batches'::regclass
       and attribute.attname = 'status'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ),
  'ocr_batches keep the legacy processing status domain without worker-only states'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
      from pg_catalog.pg_enum
     where enumtypid = 'public.page_status'::regtype
     order by enumsortorder
  $$,
  $$
    values
      ('pending'::text collate "C"),
      ('processing'::text collate "C"),
      ('ready'::text collate "C"),
      ('retryable'::text collate "C"),
      ('blocked_quota'::text collate "C"),
      ('needs_review'::text collate "C"),
      ('failed'::text collate "C")
  $$,
  'page_status contains only states that can describe a page summary'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
      from pg_catalog.pg_enum
     where enumtypid = 'public.ocr_status'::regtype
     order by enumsortorder
  $$,
  $$
    values
      ('pending'::text collate "C"),
      ('processing'::text collate "C"),
      ('ready'::text collate "C"),
      ('retryable'::text collate "C"),
      ('blocked_quota'::text collate "C"),
      ('needs_review'::text collate "C"),
      ('failed'::text collate "C"),
      ('waiting_desktop'::text collate "C")
  $$,
  'ocr_status owns the desktop-only waiting state'
);

select results_eq(
  $$
    select enumlabel::text collate "C"
      from pg_catalog.pg_enum
     where enumtypid = 'public.processing_status'::regtype
     order by enumsortorder
  $$,
  $$
    values
      ('pending'::text collate "C"),
      ('processing'::text collate "C"),
      ('ready'::text collate "C"),
      ('retryable'::text collate "C"),
      ('blocked_quota'::text collate "C"),
      ('needs_review'::text collate "C"),
      ('failed'::text collate "C")
  $$,
  'legacy processing_status never gains desktop-only job states'
);

select results_eq(
  $$
    select
      castsource = 'public.processing_status'::regtype,
      casttarget in ('public.page_status'::regtype, 'public.ocr_status'::regtype),
      castcontext::text collate "C"
      from pg_catalog.pg_cast
     where castsource = 'public.processing_status'::regtype
       and casttarget in ('public.page_status'::regtype, 'public.ocr_status'::regtype)
     order by casttarget::regtype::text
  $$,
  $$
    values
      (true, true, 'a'::text collate "C"),
      (true, true, 'a'::text collate "C")
  $$,
  'legacy status values have assignment-only compatibility into both split domains'
);

select is(
  (
    select count(*)::integer
      from pg_catalog.pg_cast
     where castsource in ('public.page_status'::regtype, 'public.ocr_status'::regtype)
       and casttarget = 'public.processing_status'::regtype
  ),
  0,
  'worker-only OCR states cannot cast back into legacy page or batch state'
);

select * from finish();
rollback;
