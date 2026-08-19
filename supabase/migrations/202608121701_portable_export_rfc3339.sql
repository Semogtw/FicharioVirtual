create or replace function public.export_portable_manifest()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'exportedAt', now(),
    'notebooks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'name', n.name,
          'description', n.description,
          'coverStyle', n.cover_style,
          'createdAt', n.created_at,
          'updatedAt', n.updated_at
        ) order by n.created_at, n.id
      )
      from public.notebooks n
      where n.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'title', d.title,
          'kind', d.kind,
          'status', d.status,
          'originalFilename', d.original_filename,
          'sha256', d.sha256,
          'notebookId', d.notebook_id,
          'createdAt', d.created_at,
          'updatedAt', d.updated_at,
          'tags', coalesce(tags.values, '[]'::jsonb),
          'pages', coalesce(pages.values, '[]'::jsonb)
        ) order by d.created_at, d.id
      )
      from public.documents d
      left join lateral (
        select jsonb_agg(t.name order by t.name) as values
        from public.document_tags dt
        join public.tags t
          on t.id = dt.tag_id
          and t.user_id = dt.user_id
        where dt.document_id = d.id
          and dt.user_id = d.user_id
      ) tags on true
      left join lateral (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'pageNumber', p.page_number,
            'nativeText', p.native_text,
            'ocrRawText', p.ocr_raw_text,
            'correctedText', p.corrected_text,
            'effectiveText', public.page_effective_text(p),
            'extractionSource', p.extraction_source,
            'warnings', p.warnings,
            'status', p.status,
            'wasManuallyReviewed', p.was_manually_reviewed,
            'updatedAt', p.updated_at
          ) order by p.page_number, p.id
        ) as values
        from public.pages p
        where p.document_id = d.id
          and p.user_id = d.user_id
      ) pages on true
      where d.user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
  where (select public.is_authorized_user());
$$;

revoke execute on function public.export_portable_manifest() from public, anon;
grant execute on function public.export_portable_manifest() to authenticated;
