create index ocr_batches_document_owner_idx
  on public.ocr_batches (document_id, user_id);
