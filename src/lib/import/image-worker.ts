/// <reference lib="webworker" />

import { analyzeDocumentLuma, type DocumentPreprocessingPlan } from './image-preprocess-analysis';
import type {
	ImagePreprocessingMetadata,
	ImageWorkerFailure,
	ImageWorkerRequest,
	ImageWorkerSuccess,
	PreparedImageFormat
} from './image-types';

const worker = self as DedicatedWorkerGlobalScope;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ANALYSIS_MAX_DIMENSION = 512;

function scaledDimensions(width: number, height: number, maximum: number) {
	const scale = Math.min(1, maximum / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

function canvas(width: number, height: number) {
	const output = new OffscreenCanvas(width, height);
	const context = output.getContext('2d', { alpha: false, willReadFrequently: true });
	if (!context) throw new Error('Canvas context unavailable');
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	return { output, context };
}

function white(context: OffscreenCanvasRenderingContext2D, width: number, height: number) {
	context.save();
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, width, height);
	context.restore();
}

async function encode(
	source: OffscreenCanvas,
	quality: number
): Promise<{ blob: Blob; format: PreparedImageFormat }> {
	const { output, context } = canvas(source.width, source.height);
	white(context, source.width, source.height);
	context.drawImage(source, 0, 0);
	const jpeg = await output.convertToBlob({ type: 'image/jpeg', quality });
	if (jpeg.size < 1 || jpeg.type !== 'image/jpeg') throw new Error('Empty encoded image');
	return { blob: jpeg, format: 'image/jpeg' };
}

function luma(red: number, green: number, blue: number) {
	return (77 * red + 150 * green + 29 * blue) >> 8;
}

function analyze(source: OffscreenCanvas) {
	const dimensions = scaledDimensions(source.width, source.height, ANALYSIS_MAX_DIMENSION);
	const sampled = canvas(dimensions.width, dimensions.height);
	white(sampled.context, dimensions.width, dimensions.height);
	sampled.context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
	const rgba = sampled.context.getImageData(0, 0, dimensions.width, dimensions.height).data;
	const pixels = new Uint8Array(dimensions.width * dimensions.height);
	for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
		pixels[pixel] = luma(rgba[index] ?? 255, rgba[index + 1] ?? 255, rgba[index + 2] ?? 255);
	}
	return {
		width: dimensions.width,
		height: dimensions.height,
		plan: analyzeDocumentLuma({ width: dimensions.width, height: dimensions.height, pixels })
	};
}

function crop(source: OffscreenCanvas, analysis: ReturnType<typeof analyze>): OffscreenCanvas {
	if (!analysis.plan.autoCropApplied) return source;
	const scaleX = source.width / analysis.width;
	const scaleY = source.height / analysis.height;
	const left = Math.max(0, Math.floor(analysis.plan.cropLeft * scaleX));
	const top = Math.max(0, Math.floor(analysis.plan.cropTop * scaleY));
	const right = Math.min(source.width, Math.ceil(analysis.plan.cropRight * scaleX));
	const bottom = Math.min(source.height, Math.ceil(analysis.plan.cropBottom * scaleY));
	const width = right - left;
	const height = bottom - top;
	if (width < 32 || height < 32) return source;
	const target = canvas(width, height);
	white(target.context, width, height);
	target.context.drawImage(source, left, top, width, height, 0, 0, width, height);
	return target.output;
}

function rotate(source: OffscreenCanvas, milliDegrees: number): OffscreenCanvas {
	if (milliDegrees === 0) return source;
	const radians = (milliDegrees / 1000) * (Math.PI / 180);
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	const width = Math.max(
		1,
		Math.ceil(Math.abs(source.width * cosine) + Math.abs(source.height * sine))
	);
	const height = Math.max(
		1,
		Math.ceil(Math.abs(source.width * sine) + Math.abs(source.height * cosine))
	);
	const target = canvas(width, height);
	white(target.context, width, height);
	target.context.translate(width / 2, height / 2);
	target.context.rotate(radians);
	target.context.drawImage(source, -source.width / 2, -source.height / 2);
	return target.output;
}

function histogramPercentile(histogram: Uint32Array, total: number, fraction: number) {
	const target = Math.max(0, Math.floor(total * fraction));
	let count = 0;
	for (let value = 0; value < histogram.length; value += 1) {
		count += histogram[value] ?? 0;
		if (count >= target) return value;
	}
	return 255;
}

function backgroundGrid(data: Uint8ClampedArray, width: number, height: number) {
	const columns = 8;
	const rows = 8;
	const values = new Float32Array(columns * rows);
	for (let gridY = 0; gridY < rows; gridY += 1) {
		const y0 = Math.floor((gridY * height) / rows);
		const y1 = Math.max(y0 + 1, Math.floor(((gridY + 1) * height) / rows));
		for (let gridX = 0; gridX < columns; gridX += 1) {
			const x0 = Math.floor((gridX * width) / columns);
			const x1 = Math.max(x0 + 1, Math.floor(((gridX + 1) * width) / columns));
			const histogram = new Uint32Array(256);
			let total = 0;
			const stride = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 48));
			for (let y = y0; y < y1; y += stride) {
				for (let x = x0; x < x1; x += stride) {
					const offset = (y * width + x) * 4;
					histogram[luma(data[offset] ?? 255, data[offset + 1] ?? 255, data[offset + 2] ?? 255)] +=
						1;
					total += 1;
				}
			}
			values[gridY * columns + gridX] =
				total > 0 ? histogramPercentile(histogram, total, 0.88) : 255;
		}
	}
	const ordered = [...values].sort((left, right) => left - right);
	const target = ordered[Math.floor(ordered.length * 0.65)] ?? 235;
	return { columns, rows, values, target };
}

function localBackground(
	grid: ReturnType<typeof backgroundGrid>,
	x: number,
	y: number,
	width: number,
	height: number
) {
	const gx = Math.max(
		0,
		Math.min(grid.columns - 1, (x / Math.max(1, width - 1)) * (grid.columns - 1))
	);
	const gy = Math.max(0, Math.min(grid.rows - 1, (y / Math.max(1, height - 1)) * (grid.rows - 1)));
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const x1 = Math.min(grid.columns - 1, x0 + 1);
	const y1 = Math.min(grid.rows - 1, y0 + 1);
	const tx = gx - x0;
	const ty = gy - y0;
	const top =
		(grid.values[y0 * grid.columns + x0] ?? grid.target) * (1 - tx) +
		(grid.values[y0 * grid.columns + x1] ?? grid.target) * tx;
	const bottom =
		(grid.values[y1 * grid.columns + x0] ?? grid.target) * (1 - tx) +
		(grid.values[y1 * grid.columns + x1] ?? grid.target) * tx;
	return top * (1 - ty) + bottom * ty;
}

function clampByte(value: number) {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function normalize(source: OffscreenCanvas, plan: DocumentPreprocessingPlan) {
	if (!plan.contrastEnhanced && !plan.illuminationNormalized) return source;
	const target = canvas(source.width, source.height);
	white(target.context, source.width, source.height);
	target.context.drawImage(source, 0, 0);
	const image = target.context.getImageData(0, 0, source.width, source.height);
	const data = image.data;
	const grid = plan.illuminationNormalized
		? backgroundGrid(data, source.width, source.height)
		: null;
	const contrastRange = Math.max(1, plan.highLuma - plan.lowLuma);
	const contrastGain = plan.contrastEnhanced ? Math.min(1.28, 232 / contrastRange) : 1;
	const contrastOffset = plan.contrastEnhanced ? 12 - plan.lowLuma * contrastGain : 0;
	const contrastBlend = plan.contrastEnhanced ? 0.38 : 0;

	for (let y = 0; y < source.height; y += 1) {
		for (let x = 0; x < source.width; x += 1) {
			const offset = (y * source.width + x) * 4;
			const illuminationOffset = grid
				? Math.max(
						-28,
						Math.min(28, grid.target - localBackground(grid, x, y, source.width, source.height))
					) * 0.58
				: 0;
			for (let channel = 0; channel < 3; channel += 1) {
				const original = (data[offset + channel] ?? 255) + illuminationOffset;
				const contrasted = original * contrastGain + contrastOffset;
				data[offset + channel] = clampByte(
					original * (1 - contrastBlend) + contrasted * contrastBlend
				);
			}
			data[offset + 3] = 255;
		}
	}
	target.context.putImageData(image, 0, 0);
	return target.output;
}

function metadata(
	request: ImageWorkerRequest,
	sourceWidth: number,
	sourceHeight: number,
	prepared: OffscreenCanvas,
	plan: DocumentPreprocessingPlan | null,
	fallbackToStandard: boolean
): ImagePreprocessingMetadata {
	return Object.freeze({
		profile: request.preprocessingProfile,
		version: 1,
		autoCropApplied: plan?.autoCropApplied ?? false,
		retainedAreaPermille: plan?.retainedAreaPermille ?? 1000,
		deskewMilliDegrees: plan?.deskewMilliDegrees ?? 0,
		illuminationNormalized: plan?.illuminationNormalized ?? false,
		contrastEnhanced: plan?.contrastEnhanced ?? false,
		fallbackToStandard,
		sourceWidth,
		sourceHeight,
		preparedWidth: prepared.width,
		preparedHeight: prepared.height
	});
}

async function prepare(request: ImageWorkerRequest): Promise<ImageWorkerSuccess> {
	if (!ALLOWED_TYPES.has(request.file.type) || request.file.size < 1) {
		throw Object.assign(new Error('Unsupported image'), { code: 'unsupported_image' });
	}
	if (request.preprocessingProfile !== 'ocr_clean_v1') {
		throw Object.assign(new Error('Unsupported preprocessing profile'), {
			code: 'unsupported_image'
		});
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(request.file, { imageOrientation: 'from-image' });
	} catch {
		throw Object.assign(new Error('Image decode failed'), { code: 'decode_failed' });
	}

	try {
		const dimensions = scaledDimensions(bitmap.width, bitmap.height, request.maxDimension);
		const base = canvas(dimensions.width, dimensions.height);
		white(base.context, dimensions.width, dimensions.height);
		base.context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

		let preparedCanvas = base.output;
		let plan: DocumentPreprocessingPlan | null = null;
		let fallbackToStandard = false;
		try {
			const analysis = analyze(base.output);
			plan = analysis.plan;
			preparedCanvas = crop(base.output, analysis);
			preparedCanvas = rotate(preparedCanvas, plan.deskewMilliDegrees);
			preparedCanvas = normalize(preparedCanvas, plan);
		} catch {
			preparedCanvas = base.output;
			plan = null;
			fallbackToStandard = true;
		}

		const thumbDimensions = scaledDimensions(
			preparedCanvas.width,
			preparedCanvas.height,
			request.thumbnailDimension
		);
		const thumbnailCanvas = canvas(thumbDimensions.width, thumbDimensions.height);
		white(thumbnailCanvas.context, thumbDimensions.width, thumbDimensions.height);
		thumbnailCanvas.context.drawImage(
			preparedCanvas,
			0,
			0,
			thumbDimensions.width,
			thumbDimensions.height
		);

		let prepared: Awaited<ReturnType<typeof encode>>;
		let thumbnail: Awaited<ReturnType<typeof encode>>;
		try {
			[prepared, thumbnail] = await Promise.all([
				encode(preparedCanvas, request.quality),
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
			width: preparedCanvas.width,
			height: preparedCanvas.height,
			format: prepared.format,
			preprocessing: metadata(
				request,
				bitmap.width,
				bitmap.height,
				preparedCanvas,
				plan,
				fallbackToStandard
			)
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
