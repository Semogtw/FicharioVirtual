create index if not exists document_tags_document_user_idx
  on public.document_tags (document_id, user_id);

create index if not exists document_tags_tag_user_idx
  on public.document_tags (tag_id, user_id);

create index if not exists documents_notebook_user_idx
  on public.documents (notebook_id, user_id)
  where notebook_id is not null;

create index if not exists ocr_jobs_page_user_idx
  on public.ocr_jobs (page_id, user_id);

create index if not exists pages_document_user_idx
  on public.pages (document_id, user_id);
