-- Launch hardening: claim_ocr_job is a user-scoped SECURITY DEFINER RPC.
-- Keep its callable surface explicit after the pre-launch signature cleanup so
-- PostgreSQL's default PUBLIC execute privilege can never expose it broadly.

revoke execute on function public.claim_ocr_job(uuid, text, timestamptz)
  from public, anon;

grant execute on function public.claim_ocr_job(uuid, text, timestamptz)
  to authenticated;
