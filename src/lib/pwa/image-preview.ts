export type LocalImagePreviewOptions = Readonly<{
	maxDimension?: number;
	quality?: number;
}>;

function validatedOptions(options: LocalImagePreviewOptions) {
	const maxDimension = options.maxDimension ?? 2560;
	const quality = options.quality ?? 0.9;
	if (!Number.isInteger(maxDimension) || maxDimension < 1600 || maxDimension > 3200) {
		throw new TypeError('Invalid local image preview dimension');
	}
	if (!Number.isFinite(quality) || quality < 0.75 || quality > 0.95) {
		throw new TypeError('Invalid local image preview quality');
	}
	return { maxDimension, quality };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
	return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function createLocalImagePreview(
	source: Blob,
	options: LocalImagePreviewOptions = {}
): Promise<Blob | null> {
	const { maxDimension, quality } = validatedOptions(options);
	if (source.size < 1 || !source.type.startsWith('image/')) return null;
	if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return null;

	let bitmap: ImageBitmap | null = null;
	let canvas: HTMLCanvasElement | null = null;
	try {
		bitmap = await createImageBitmap(source);
		const largestDimension = Math.max(bitmap.width, bitmap.height);
		if (largestDimension < 1) return null;
		const scale = Math.min(1, maxDimension / largestDimension);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) return null;
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, width, height);
		context.drawImage(bitmap, 0, 0, width, height);

		const webp = await canvasBlob(canvas, 'image/webp', quality);
		if (webp && webp.size > 0 && webp.type === 'image/webp' && webp.size < source.size) {
			return webp;
		}
		const jpeg = await canvasBlob(canvas, 'image/jpeg', quality);
		if (jpeg && jpeg.size > 0 && jpeg.type === 'image/jpeg' && jpeg.size < source.size) {
			return jpeg;
		}
		return null;
	} catch {
		return null;
	} finally {
		bitmap?.close();
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
	}
}
