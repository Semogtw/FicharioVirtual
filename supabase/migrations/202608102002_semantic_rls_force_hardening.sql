-- Close the final semantic database privilege gaps detected by the offline
-- migration gate. These tables are accessed only through RLS-safe reads or
-- explicitly authorized SECURITY DEFINER RPCs.

alter table public.page_semantic_chunks force row level security;
alter table public.semantic_query_embedding_cache force row level security;
alter table public.semantic_retrieval_events force row level security;
alter table public.semantic_index_failures force row level security;

-- CREATE OR REPLACE preserves existing ACLs, but each SECURITY DEFINER
-- replacement is followed by an explicit final revocation so PUBLIC/anon can
-- never inherit the PostgreSQL default EXECUTE privilege.
revoke execute on function public.replace_page_semantic_chunks(uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.replace_page_semantic_chunks(uuid, text, text, jsonb)
  to authenticated;
