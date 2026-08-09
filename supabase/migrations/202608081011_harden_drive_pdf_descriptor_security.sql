-- Keep already-applied descriptor functions hardened when staging is upgraded
-- from a checkout that contains the original migrations.

alter function public.stage_drive_pdf_reference_page_batch(uuid, jsonb)
  set search_path = '';
alter function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer)
  set search_path = '';
alter function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  set search_path = '';
alter function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  set search_path = '';
alter function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb)
  set search_path = '';
alter function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  set search_path = '';
alter function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  set search_path = '';

revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  from public, anon;
revoke execute on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  from public, anon;
revoke execute on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb)
  from public, anon;
revoke execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  from public, anon;
revoke execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  from public, anon;

grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb)
  to service_role;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer)
  to service_role;
grant execute on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  to authenticated, service_role;
grant execute on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)
  to authenticated, service_role;
grant execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid)
  to authenticated, service_role;
