create type public.document_kind as enum ('image', 'pdf');
create type public.document_status as enum (
  'uploading',
  'pending',
  'processing',
  'ready',
  'partially_ready',
  'needs_review',
  'failed'
);
create type public.processing_status as enum (
  'pending',
  'processing',
  'ready',
  'retryable',
  'blocked_quota',
  'needs_review',
  'failed'
);
create type public.extraction_source as enum ('native_pdf', 'ocr', 'manual');
create type public.import_status as enum (
  'draft',
  'preparing',
  'uploading',
  'processing',
  'completed',
  'paused',
  'failed',
  'cancelled'
);

create table public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.notebooks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  cover_style text not null default 'linen'
    check (cover_style ~ '^[a-z][a-z0-9_-]{1,31}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create unique index notebooks_user_name_unique
  on public.notebooks (user_id, lower(name));

create table public.documents (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid,
  title text not null check (char_length(title) between 1 and 240),
  kind public.document_kind not null,
  original_filename text not null check (char_length(original_filename) between 1 and 512),
  storage_path text not null check (
    char_length(storage_path) between 3 and 1024
    and storage_path like user_id::text || '/%'
  ),
  thumbnail_path text check (
    thumbnail_path is null
    or (
      char_length(thumbnail_path) between 3 and 1024
      and thumbnail_path like user_id::text || '/%'
    )
  ),
  page_count integer not null default 0 check (page_count >= 0),
  status public.document_status not null default 'uploading',
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  source_created_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (notebook_id, user_id)
    references public.notebooks(id, user_id)
);

create unique index documents_user_sha256_unique
  on public.documents (user_id, sha256)
  where sha256 is not null;
create index documents_user_created_idx
  on public.documents (user_id, created_at desc);
create index documents_notebook_created_idx
  on public.documents (notebook_id, created_at desc)
  where notebook_id is not null;

create table public.pages (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  page_number integer not null check (page_number >= 1),
  native_text text,
  ocr_raw_text text,
  corrected_text text,
  normalized_text text not null default '',
  search_vector tsvector not null default ''::tsvector,
  extraction_source public.extraction_source,
  temporary_image_path text check (
    temporary_image_path is null
    or (
      char_length(temporary_image_path) between 3 and 1024
      and temporary_image_path like user_id::text || '/%'
    )
  ),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  status public.processing_status not null default 'pending',
  was_manually_reviewed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (document_id, page_number),
  unique (id, user_id),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade
);

create index pages_user_status_idx
  on public.pages (user_id, status, updated_at desc);
create index pages_document_number_idx
  on public.pages (document_id, page_number);
create index pages_search_vector_idx
  on public.pages using gin (search_vector);
create index pages_normalized_text_trgm_idx
  on public.pages using gin (normalized_text extensions.gin_trgm_ops);

create table public.ocr_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null,
  provider text not null default 'gemini'
    check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  model text check (model is null or char_length(model) between 1 and 128),
  prompt_version integer not null default 1 check (prompt_version >= 1),
  status public.processing_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 16 and 160),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) <= 500
  ),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (page_id, user_id)
    references public.pages(id, user_id)
    on delete cascade
);

create index ocr_jobs_runnable_idx
  on public.ocr_jobs (status, next_retry_at, created_at)
  where status in ('pending', 'retryable');
create index ocr_jobs_user_status_idx
  on public.ocr_jobs (user_id, status, updated_at desc);

create table public.tags (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  normalized_name text not null check (char_length(normalized_name) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  unique (user_id, normalized_name)
);

create table public.document_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, tag_id),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  foreign key (tag_id, user_id)
    references public.tags(id, user_id)
    on delete cascade
);

create index document_tags_user_tag_idx
  on public.document_tags (user_id, tag_id);

create table public.import_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.import_status not null default 'draft',
  total_items integer not null default 0 check (total_items >= 0),
  prepared_items integer not null default 0 check (
    prepared_items >= 0 and prepared_items <= total_items
  ),
  uploaded_items integer not null default 0 check (
    uploaded_items >= 0 and uploaded_items <= total_items
  ),
  completed_items integer not null default 0 check (
    completed_items >= 0 and completed_items <= total_items
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  local_resume_key text check (
    local_resume_key is null or char_length(local_resume_key) between 16 and 160
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  unique (id, user_id)
);

create index import_sessions_user_active_idx
  on public.import_sessions (user_id, updated_at desc)
  where status not in ('completed', 'cancelled');

create table public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  ocr_pages integer not null default 0 check (ocr_pages >= 0),
  quality_reprocess_pages integer not null default 0 check (quality_reprocess_pages >= 0),
  quota_errors integer not null default 0 check (quota_errors >= 0),
  failed_pages integer not null default 0 check (failed_pages >= 0),
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  storage_bytes_estimated bigint not null default 0 check (storage_bytes_estimated >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, usage_date)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger notebooks_set_updated_at
before update on public.notebooks
for each row execute function public.set_updated_at();

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

create trigger pages_set_updated_at
before update on public.pages
for each row execute function public.set_updated_at();

create trigger ocr_jobs_set_updated_at
before update on public.ocr_jobs
for each row execute function public.set_updated_at();

create trigger import_sessions_set_updated_at
before update on public.import_sessions
for each row execute function public.set_updated_at();

revoke execute on function public.set_updated_at() from public, anon, authenticated;
