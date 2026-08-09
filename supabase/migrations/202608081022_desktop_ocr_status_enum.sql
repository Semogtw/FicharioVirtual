-- PostgreSQL enum values must be committed before later migrations consume them.
-- Keep this migration intentionally isolated from table/function changes.

alter type public.ocr_status add value if not exists 'waiting_desktop';
