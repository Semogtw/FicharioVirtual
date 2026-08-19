import type { OcrBatchParseOutcome } from './ocr-batch-contract.ts';

export type OcrProviderId = 'gemini' | 'azure_vision';

export type OcrProviderPage = Readonly<{
	pageId: string;
	pageNumber: number;
	mimeType: string;
	bytes: Uint8Array;
}>;

export type OcrProviderBatchRequest = Readonly<{
	model: string;
	pages: readonly OcrProviderPage[];
	promptVersion: number;
	signal?: AbortSignal;
}>;

export type OcrProviderUsage = Readonly<{
	requestCount: number;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
}>;

export type OcrProviderOutcome = OcrBatchParseOutcome &
	Readonly<{
		provider: OcrProviderId;
		model: string;
		providerModelVersion: string | null;
		providerResponseId: string | null;
		usage: OcrProviderUsage | null;
	}>;

export type OcrProvider = Readonly<{
	id: OcrProviderId;
	requestBatch(request: OcrProviderBatchRequest): Promise<OcrProviderOutcome>;
}>;
