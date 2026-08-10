create index page_semantic_chunks_embedding_hnsw_idx
  on public.page_semantic_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);
