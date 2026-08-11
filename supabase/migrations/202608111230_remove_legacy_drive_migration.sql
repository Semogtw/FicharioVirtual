drop function if exists public.complete_drive_legacy_migration(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text
);

drop index if exists public.documents_pending_drive_migration_idx;
drop index if exists public.documents_drive_fallback_pending_idx;

alter table public.documents
  drop constraint if exists documents_drive_migration_receipt_check;

alter table public.documents
  drop column if exists drive_migrated_at;
