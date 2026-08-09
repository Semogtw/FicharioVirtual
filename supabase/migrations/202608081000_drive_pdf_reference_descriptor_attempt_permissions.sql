-- Once renewable descriptor attempts are available, large Drive PDF publication
-- must not be reachable through the pre-lease browser entry points. The leased
-- SECURITY DEFINER finalizer still delegates to the hardened finalizer as its
-- owner, while service_role keeps an explicit maintenance/testing escape hatch.

revoke execute on function public.finalize_drive_pdf_reference_import(uuid, jsonb, integer)
from authenticated, anon;
grant execute on function public.finalize_drive_pdf_reference_import(uuid, jsonb, integer)
to service_role;

revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb)
from authenticated, anon;
grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb)
to service_role;

revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer)
from authenticated, anon;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer)
to service_role;
