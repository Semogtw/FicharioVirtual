import { describe, expect, it } from 'vitest';
import {
	loadUsageOverview,
	parseUsageOverview,
	UsageServiceError,
	type UsageClientLike
} from '../../../src/lib/services/usage';

const payload = {
	generatedAt: '2026-08-02T07:00:00.000Z',
	today: {
		date: '2026-08-02',
		ocrPages: 12,
		ocrBatches: 3,
		ocrCalls: 3,
		ocrAttempts: 13,
		averageBatchSize: 4,
		quotaErrors: 1
	},
	totals: {
		notebooks: 4,
		documents: 18,
		pages: 72,
		pendingPages: 3,
		blockedQuotaPages: 1,
		reviewPages: 2,
		failedPages: 1,
		manualReviews: 9
	},
	daily: [
		{
			date: '2026-08-01',
			ocrPages: 8,
			ocrBatches: 2,
			ocrCalls: 2,
			ocrAttempts: 8,
			averageBatchSize: 4,
			quotaErrors: 0
		},
		{
			date: '2026-08-02',
			ocrPages: 12,
			ocrBatches: 3,
			ocrCalls: 3,
			ocrAttempts: 13,
			averageBatchSize: 4,
			quotaErrors: 1
		}
	]
};

describe('usage overview', () => {
	it('parses a bounded content-free operational snapshot', () => {
		expect(parseUsageOverview(payload)).toEqual(payload);
		expect(JSON.stringify(parseUsageOverview(payload))).not.toContain('text');
		expect(JSON.stringify(parseUsageOverview(payload))).not.toContain('remaining');
	});

	it('rejects negative counters, impossible averages and unexpected fields', () => {
		expect(() =>
			parseUsageOverview({ ...payload, today: { ...payload.today, ocrPages: -1 } })
		).toThrow('Invalid usage overview');
		expect(() =>
			parseUsageOverview({ ...payload, today: { ...payload.today, averageBatchSize: -1 } })
		).toThrow('Invalid usage overview');
		expect(() => parseUsageOverview({ ...payload, privateContent: 'no' })).toThrow(
			'Invalid usage overview'
		);
		expect(() =>
			parseUsageOverview({ ...payload, generatedAt: '2026-02-30T00:00:00.000Z' })
		).toThrow('Invalid usage overview');
		expect(() =>
			parseUsageOverview({ ...payload, today: { ...payload.today, date: '2026-02-30' } })
		).toThrow('Invalid usage overview');
	});

	it('validates the RPC response before exposing it', async () => {
		const client: UsageClientLike = {
			async rpc() {
				return { data: payload, error: null };
			}
		};
		await expect(loadUsageOverview(client)).resolves.toEqual(payload);
	});

	it('normalizes malformed payloads as service failures', async () => {
		const client: UsageClientLike = {
			async rpc() {
				return { data: { generatedAt: 'invalid' }, error: null };
			}
		};

		await expect(loadUsageOverview(client)).rejects.toBeInstanceOf(UsageServiceError);
	});

	it('normalizes transport failures without leaking backend details', async () => {
		const client: UsageClientLike = {
			async rpc() {
				throw new Error('connection refused by internal host');
			}
		};

		await expect(loadUsageOverview(client)).rejects.toEqual(
			expect.objectContaining({
				name: 'UsageServiceError',
				message: 'Não foi possível carregar o uso operacional agora.'
			})
		);
	});
});
