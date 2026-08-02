/// <reference lib="webworker" />

import type {
	ImageWorkerFailure,
	ImageWorkerRequest,
	ImageWorkerSuccess,
	PreparedImageFormat
} from './image-types';

const worker = self as DedicatedWorkerGlobalScope;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function scaledDimensions(width: number, height: number, maximum: number) {
	const scale = Math.min(1, maximum / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

function canvas(width: number, height: number) {
	const output = new OffscreenCanvas(width, height);
	const context = output.getContext('2d', { alpha: true });
	if (!context) throw new Error('Canvas context unavailable');
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	return { output, context };
}

async function encode(
	source: OffscreenCanvas,
	quality: number
): Promise<{ blob: Blob; format: PreparedImageFormat }> {
	try {
		const webp = await source.convertToBlob({ type: 'image/webp', quality });
		if (webp.size > 0 && webp.type === 'image/webp') {
			return { blob: webp, format: 'image/webp' };
		}
	} catch {
		// JPEG is the documented fallback when WebP encoding is unavailable.
	}

	const { output, context } = canvas(source.width, source.height);
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, source.width, source.height);
	context.drawImage(source, 0, 0);
	const jpeg = await output.convertToBlob({ type: 'image/jpeg', quality });
	if (jpeg.size < 1) throw new Error('Empty encoded image');
	return { blob: jpeg, format: 'image/jpeg' };
}

async function prepare(request: ImageWorkerRequest): Promise<ImageWorkerSuccess> {
	if (!ALLOWED_TYPES.has(request.file.type) || request.file.size < 1) {
		throw Object.assign(new Error('Unsupported image'), { code: 'unsupported_image' });
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(request.file, { imageOrientation: 'from-image' });
	} catch {
		throw Object.assign(new Error('Image decode failed'), { code: 'decode_failed' });
	}

	try {
		const dimensions = scaledDimensions(bitmap.width, bitmap.height, request.maxDimension);
		const preparedCanvas = canvas(dimensions.width, dimensions.height);
		preparedCanvas.context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

		const thumbDimensions = scaledDimensions(
			dimensions.width,
			dimensions.height,
			request.thumbnailDimension
		);
		const thumbnailCanvas = canvas(thumbDimensions.width, thumbDimensions.height);
		thumbnailCanvas.context.drawImage(
			preparedCanvas.output,
			0,
			0,
			thumbDimensions.width,
			thumbDimensions.height
		);

		let prepared: Awaited<ReturnType<typeof encode>>;
		let thumbnail: Awaited<ReturnType<typeof encode>>;
		try {
			[prepared, thumbnail] = await Promise.all([
				encode(preparedCanvas.output, request.quality),
				encode(thumbnailCanvas.output, Math.min(request.quality, 0.82))
			]);
		} catch {
			throw Object.assign(new Error('Image encode failed'), { code: 'encode_failed' });
		}

		return {
			type: 'success',
			id: request.id,
			image: prepared.blob,
			thumbnail: thumbnail.blob,
			width: dimensions.width,
			height: dimensions.height,
			format: prepared.format
		};
	} finally {
		bitmap.close();
	}
}

worker.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
	const request = event.data;
	if (request?.type !== 'prepare' || typeof request.id !== 'string') return;

	try {
		worker.postMessage(await prepare(request));
	} catch (error) {
		const candidate = error as { code?: ImageWorkerFailure['code'] };
		const failure: ImageWorkerFailure = {
			type: 'failure',
			id: request.id,
			code:
				candidate.code === 'decode_failed' ||
				candidate.code === 'encode_failed' ||
				candidate.code === 'unsupported_image'
					? candidate.code
					: 'worker_failed'
		};
		worker.postMessage(failure);
	}
};

export {};
