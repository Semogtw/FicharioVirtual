-- The provider circuit breaker was raised from 15 to 190 RPD. Jobs that were
-- deferred by the old 15-RPD guard must become eligible immediately; otherwise
-- they remain hidden from both the foreground resume RPC and the background
-- worker until the obsolete Pacific reset timestamp.

update public.ocr_jobs
set next_retry_at = timezone('utc', now())
where status = 'retryable'::public.ocr_status
  and last_error_code = 'ocr_provider_rate_queue_full'
  and next_retry_at is not null
  and next_retry_at > timezone('utc', now());

update public.ocr_batches
set next_retry_at = timezone('utc', now())
where status = 'retryable'::public.processing_status
  and last_error_code = 'ocr_provider_rate_queue_full'
  and next_retry_at is not null
  and next_retry_at > timezone('utc', now());
