alter table public.ocr_provider_page_metrics
  add column if not exists preprocessing_profile text,
  add column if not exists preprocessing_version integer,
  add column if not exists preprocessing_auto_crop boolean not null default false,
  add column if not exists preprocessing_retained_permille integer not null default 1000,
  add column if not exists preprocessing_deskew_mdeg integer not null default 0,
  add column if not exists preprocessing_illumination boolean not null default false,
  add column if not exists preprocessing_contrast boolean not null default false,
  add column if not exists preprocessing_fallback boolean not null default false,
  add column if not exists preprocessing_original_bytes bigint,
  add column if not exists preprocessing_prepared_bytes bigint;

alter table public.ocr_provider_page_metrics
  drop constraint if exists ocr_provider_page_metrics_preprocessing_profile_check,
  drop constraint if exists ocr_provider_page_metrics_preprocessing_version_check,
  drop constraint if exists ocr_provider_page_metrics_preprocessing_retained_check,
  drop constraint if exists ocr_provider_page_metrics_preprocessing_deskew_check,
  drop constraint if exists ocr_provider_page_metrics_preprocessing_bytes_check;

alter table public.ocr_provider_page_metrics
  add constraint ocr_provider_page_metrics_preprocessing_profile_check check (
    preprocessing_profile is null or preprocessing_profile in ('ocr_clean_v1')
  ),
  add constraint ocr_provider_page_metrics_preprocessing_version_check check (
    preprocessing_version is null or preprocessing_version between 1 and 10000
  ),
  add constraint ocr_provider_page_metrics_preprocessing_retained_check check (
    preprocessing_retained_permille between 1 and 1000
  ),
  add constraint ocr_provider_page_metrics_preprocessing_deskew_check check (
    preprocessing_deskew_mdeg between -4000 and 4000
  ),
  add constraint ocr_provider_page_metrics_preprocessing_bytes_check check (
    (preprocessing_original_bytes is null or preprocessing_original_bytes between 1 and 67108864)
    and (preprocessing_prepared_bytes is null or preprocessing_prepared_bytes between 1 and 67108864)
  );

create or replace function public.fill_ocr_preprocessing_telemetry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select
    p.ocr_preprocessing_profile,
    p.ocr_preprocessing_version,
    p.ocr_preprocessing_auto_crop,
    p.ocr_preprocessing_retained_permille,
    p.ocr_preprocessing_deskew_mdeg,
    p.ocr_preprocessing_illumination,
    p.ocr_preprocessing_contrast,
    p.ocr_preprocessing_fallback,
    p.ocr_preprocessing_original_bytes,
    p.ocr_preprocessing_prepared_bytes
  into
    new.preprocessing_profile,
    new.preprocessing_version,
    new.preprocessing_auto_crop,
    new.preprocessing_retained_permille,
    new.preprocessing_deskew_mdeg,
    new.preprocessing_illumination,
    new.preprocessing_contrast,
    new.preprocessing_fallback,
    new.preprocessing_original_bytes,
    new.preprocessing_prepared_bytes
  from public.pages as p
  where p.id = new.page_id
    and p.user_id = new.user_id
    and p.document_id = new.document_id;

  return new;
end;
$$;

revoke all on function public.fill_ocr_preprocessing_telemetry() from public, anon, authenticated;
grant execute on function public.fill_ocr_preprocessing_telemetry() to service_role;

drop trigger if exists fill_ocr_preprocessing_telemetry on public.ocr_provider_page_metrics;
create trigger fill_ocr_preprocessing_telemetry
before insert on public.ocr_provider_page_metrics
for each row execute function public.fill_ocr_preprocessing_telemetry();

create index if not exists ocr_provider_page_metrics_preprocessing_idx
  on public.ocr_provider_page_metrics (user_id, preprocessing_profile, created_at desc)
  where preprocessing_profile is not null;

create or replace function public.get_ocr_preprocessing_overview(window_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  start_date timestamptz;
  result jsonb;
begin
  if current_user_id is null
    or not (select public.is_authorized_user())
    or window_days not between 1 and 365
  then
    return null;
  end if;

  start_date := now() - make_interval(days => window_days - 1);

  with metrics as (
    select m.*
    from public.ocr_provider_page_metrics as m
    where m.user_id = current_user_id
      and m.created_at >= start_date
      and m.preprocessing_profile is not null
  ), grouped as (
    select
      preprocessing_profile as profile,
      preprocessing_version as version,
      count(*) as pages,
      count(*) filter (where needs_review) as review_pages,
      count(*) filter (where preprocessing_auto_crop) as auto_crop_pages,
      count(*) filter (where preprocessing_deskew_mdeg <> 0) as deskew_pages,
      count(*) filter (where preprocessing_illumination) as illumination_pages,
      count(*) filter (where preprocessing_contrast) as contrast_pages,
      count(*) filter (where preprocessing_fallback) as fallback_pages,
      coalesce(sum(preprocessing_original_bytes), 0) as original_bytes,
      coalesce(sum(preprocessing_prepared_bytes), 0) as prepared_bytes,
      round(avg(preprocessing_retained_permille)::numeric, 2) as avg_retained_permille,
      round(avg(warning_count)::numeric, 2) as avg_warning_count
    from metrics
    group by preprocessing_profile, preprocessing_version
    order by preprocessing_profile, preprocessing_version
  )
  select jsonb_build_object(
    'generatedAt', timezone('utc', now()),
    'windowDays', window_days,
    'profiles', coalesce((select jsonb_agg(to_jsonb(grouped)) from grouped), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke execute on function public.get_ocr_preprocessing_overview(integer) from public, anon;
grant execute on function public.get_ocr_preprocessing_overview(integer) to authenticated;
