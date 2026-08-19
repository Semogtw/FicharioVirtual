import {
	requestGeminiOcrBatch,
	type GeminiOcrBatchOutcome,
	type GeminiOcrBatchRequest
} from './gemini-ocr-client.ts';
import type {
	OcrProvider,
	OcrProviderBatchRequest,
	OcrProviderOutcome,
	OcrProviderUsage
} from './ocr-provider.ts';

type GeminiRequestImpl = (request: GeminiOcrBatchRequest) => Promise<GeminiOcrBatchOutcome>;

export type GeminiOcrProviderOptions = Readonly<{
	apiKey: string;
	fetchImpl?: typeof fetch;
	requestImpl?: GeminiRequestImpl;
}>;

function normalizedUsage(outcome: GeminiOcrBatchOutcome): OcrProviderUsage | null {
	if (outcome.usage === null) return null;
	return Object.freeze({
		requestCount: 1,
		inputTokens: outcome.usage.promptTokenCount,
		outputTokens: outcome.usage.candidatesTokenCount,
		totalTokens: outcome.usage.totalTokenCount
	});
}

export function createGeminiOcrProvider(options: GeminiOcrProviderOptions): OcrProvider {
	const requestImpl = options.requestImpl ?? requestGeminiOcrBatch;
	return Object.freeze({
		id: 'gemini' as const,
		async requestBatch(request: OcrProviderBatchRequest): Promise<OcrProviderOutcome> {
			const outcome = await requestImpl({
				apiKey: options.apiKey,
				model: request.model,
				pages: request.pages,
				promptVersion: request.promptVersion,
				signal: request.signal,
				fetchImpl: options.fetchImpl
			});

			return Object.freeze({
				valid: outcome.valid,
				pages: outcome.pages,
				missingPageIds: outcome.missingPageIds,
				duplicatePageIds: outcome.duplicatePageIds,
				unexpectedPageIds: outcome.unexpectedPageIds,
				provider: 'gemini' as const,
				model: request.model,
				providerModelVersion: outcome.modelVersion,
				providerResponseId: outcome.responseId,
				usage: normalizedUsage(outcome)
			});
		}
	});
}
