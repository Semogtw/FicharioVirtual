-- Semantic text v2 adds conservative OCR/layout normalization before embedding.
-- Version the source hash so already-indexed pages are treated as stale and
-- opportunistically rebuilt with the new normalized text.
create or replace function public.semantic_source_hash(input_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      'semantic-document-v2' || E'\n' || coalesce(input_text, ''),
      'sha256'
    ),
    'hex'
  );
$$;

revoke execute on function public.semantic_source_hash(text) from public, anon;
grant execute on function public.semantic_source_hash(text) to authenticated;
