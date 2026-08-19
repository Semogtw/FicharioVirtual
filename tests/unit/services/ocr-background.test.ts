import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { kickOcrQueue, OcrBackgroundKickError } from '../../../src/lib/services/ocr-background';
import type { Database } from '../../../src/lib/types/database';

function clientWithInvoke(invoke: ReturnType<typeof vi.fn>) {
	return {
		functions: { invoke }
	} as unknown as SupabaseClient<Database>;
}

describe('background OCR queue kick', () => {
	it('retries one transient invocation failure and succeeds on the next receipt', async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ data: null, error: new Error('temporary gateway failure') })
			.mockResolvedValueOnce({ data: { accepted: true }, error: null });

		await expect(kickOcrQueue(clientWithInvoke(invoke))).resolves.toBe(true);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it('does not hide a persistent kick failure', async () => {
		const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('unavailable') });

		await expect(kickOcrQueue(clientWithInvoke(invoke))).rejects.toBeInstanceOf(
			OcrBackgroundKickError
		);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed success payloads after the bounded retry', async () => {
		const invoke = vi.fn().mockResolvedValue({ data: { accepted: false }, error: null });

		await expect(kickOcrQueue(clientWithInvoke(invoke))).rejects.toBeInstanceOf(
			OcrBackgroundKickError
		);
		expect(invoke).toHaveBeenCalledTimes(2);
	});
});
