export type DocumentLumaPlane = Readonly<{
	width: number;
	height: number;
	pixels: Uint8Array;
}>;

export type DocumentPreprocessingPlan = Readonly<{
	cropLeft: number;
	cropTop: number;
	cropRight: number;
	cropBottom: number;
	autoCropApplied: boolean;
	retainedAreaPermille: number;
	deskewMilliDegrees: number;
	contrastEnhanced: boolean;
	illuminationNormalized: boolean;
	lowLuma: number;
	highLuma: number;
	backgroundLuma: number;
	foregroundPermille: number;
}>;

const MAX_SAMPLE_PIXELS = 512 * 512;
const ANGLES_MDEG = Object.freeze([
	-4000,
	-3500,
	-3000,
	-2500,
	-2000,
	-1500,
	-1000,
	-500,
	0,
	500,
	1000,
	1500,
	2000,
	2500,
	3000,
	3500,
	4000
]);

function validPlane(plane: DocumentLumaPlane) {
	return (
		Number.isInteger(plane.width) &&
		plane.width >= 8 &&
		plane.width <= 4096 &&
		Number.isInteger(plane.height) &&
		plane.height >= 8 &&
		plane.height <= 4096 &&
		plane.pixels instanceof Uint8Array &&
		plane.pixels.length === plane.width * plane.height &&
		plane.pixels.length <= MAX_SAMPLE_PIXELS
	);
}

function percentile(histogram: Uint32Array, total: number, fraction: number) {
	const target = Math.max(0, Math.min(total - 1, Math.floor(total * fraction)));
	let count = 0;
	for (let value = 0; value < histogram.length; value += 1) {
		count += histogram[value] ?? 0;
		if (count > target) return value;
	}
	return 255;
}

function histogramFor(plane: DocumentLumaPlane) {
	const histogram = new Uint32Array(256);
	for (const value of plane.pixels) histogram[value] += 1;
	return histogram;
}

function foregroundThreshold(low: number, high: number) {
	const range = Math.max(1, high - low);
	return Math.max(24, Math.min(220, Math.round(high - Math.max(14, range * 0.16))));
}

function findActiveBounds(plane: DocumentLumaPlane, threshold: number) {
	const rowCounts = new Uint32Array(plane.height);
	const columnCounts = new Uint32Array(plane.width);
	let foreground = 0;
	for (let y = 0; y < plane.height; y += 1) {
		const rowOffset = y * plane.width;
		for (let x = 0; x < plane.width; x += 1) {
			if ((plane.pixels[rowOffset + x] ?? 255) >= threshold) continue;
			rowCounts[y] += 1;
			columnCounts[x] += 1;
			foreground += 1;
		}
	}

	const minimumRowInk = Math.max(2, Math.floor(plane.width * 0.004));
	const minimumColumnInk = Math.max(2, Math.floor(plane.height * 0.004));
	let top = 0;
	let bottom = plane.height;
	let left = 0;
	let right = plane.width;
	while (top < bottom && (rowCounts[top] ?? 0) < minimumRowInk) top += 1;
	while (bottom > top && (rowCounts[bottom - 1] ?? 0) < minimumRowInk) bottom -= 1;
	while (left < right && (columnCounts[left] ?? 0) < minimumColumnInk) left += 1;
	while (right > left && (columnCounts[right - 1] ?? 0) < minimumColumnInk) right -= 1;

	return { left, top, right, bottom, foreground };
}

function conservativeCrop(
	plane: DocumentLumaPlane,
	bounds: ReturnType<typeof findActiveBounds>
) {
	if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
		return { left: 0, top: 0, right: plane.width, bottom: plane.height, applied: false };
	}
	const paddingX = Math.max(2, Math.round(plane.width * 0.018));
	const paddingY = Math.max(2, Math.round(plane.height * 0.018));
	const left = Math.max(0, bounds.left - paddingX);
	const top = Math.max(0, bounds.top - paddingY);
	const right = Math.min(plane.width, bounds.right + paddingX);
	const bottom = Math.min(plane.height, bounds.bottom + paddingY);
	const retained = ((right - left) * (bottom - top)) / (plane.width * plane.height);
	const removedOnEachAxis =
		(left > plane.width * 0.012 || plane.width - right > plane.width * 0.012) &&
		(top > plane.height * 0.012 || plane.height - bottom > plane.height * 0.012);
	const applied = retained >= 0.58 && retained <= 0.965 && removedOnEachAxis;
	return applied
		? { left, top, right, bottom, applied }
		: { left: 0, top: 0, right: plane.width, bottom: plane.height, applied: false };
}

function projectionScore(
	plane: DocumentLumaPlane,
	threshold: number,
	angleMilliDegrees: number,
	crop: { left: number; top: number; right: number; bottom: number }
) {
	const radians = (angleMilliDegrees / 1000) * (Math.PI / 180);
	const slope = Math.tan(radians);
	const centerX = (crop.left + crop.right) / 2;
	const extra = Math.ceil(Math.abs(slope) * (crop.right - crop.left));
	const bins = new Uint32Array(crop.bottom - crop.top + extra * 2 + 4);
	let active = 0;
	for (let y = crop.top; y < crop.bottom; y += 2) {
		const rowOffset = y * plane.width;
		for (let x = crop.left; x < crop.right; x += 2) {
			if ((plane.pixels[rowOffset + x] ?? 255) >= threshold) continue;
			const projected = Math.round(y - crop.top + slope * (x - centerX)) + extra + 1;
			if (projected >= 0 && projected < bins.length) bins[projected] += 1;
			active += 1;
		}
	}
	if (active < 120) return { score: 0, active };
	let score = 0;
	for (const count of bins) score += count * count;
	return { score: score / active, active };
}

function deskew(
	plane: DocumentLumaPlane,
	threshold: number,
	crop: { left: number; top: number; right: number; bottom: number }
) {
	const baseline = projectionScore(plane, threshold, 0, crop);
	if (baseline.active < 120 || baseline.score <= 0) return 0;
	let bestAngle = 0;
	let bestScore = baseline.score;
	for (const angle of ANGLES_MDEG) {
		if (angle === 0) continue;
		const candidate = projectionScore(plane, threshold, angle, crop);
		if (candidate.score > bestScore) {
			bestScore = candidate.score;
			bestAngle = angle;
		}
	}
	if (Math.abs(bestAngle) < 500 || bestScore / baseline.score < 1.075) return 0;
	return bestAngle;
}

function backgroundVariation(plane: DocumentLumaPlane) {
	const tilesX = 4;
	const tilesY = 4;
	const backgrounds: number[] = [];
	for (let tileY = 0; tileY < tilesY; tileY += 1) {
		const y0 = Math.floor((tileY * plane.height) / tilesY);
		const y1 = Math.max(y0 + 1, Math.floor(((tileY + 1) * plane.height) / tilesY));
		for (let tileX = 0; tileX < tilesX; tileX += 1) {
			const x0 = Math.floor((tileX * plane.width) / tilesX);
			const x1 = Math.max(x0 + 1, Math.floor(((tileX + 1) * plane.width) / tilesX));
			const histogram = new Uint32Array(256);
			let total = 0;
			for (let y = y0; y < y1; y += 2) {
				const rowOffset = y * plane.width;
				for (let x = x0; x < x1; x += 2) {
					histogram[plane.pixels[rowOffset + x] ?? 255] += 1;
					total += 1;
				}
			}
			backgrounds.push(total > 0 ? percentile(histogram, total, 0.88) : 255);
		}
	}
	backgrounds.sort((left, right) => left - right);
	const low = backgrounds[Math.floor(backgrounds.length * 0.15)] ?? 255;
	const high = backgrounds[Math.floor(backgrounds.length * 0.85)] ?? low;
	return Math.max(0, high - low);
}

export function analyzeDocumentLuma(plane: DocumentLumaPlane): DocumentPreprocessingPlan {
	if (!validPlane(plane)) throw new TypeError('Invalid document luminance plane');
	const histogram = histogramFor(plane);
	const total = plane.pixels.length;
	const lowLuma = percentile(histogram, total, 0.04);
	const highLuma = percentile(histogram, total, 0.94);
	const backgroundLuma = percentile(histogram, total, 0.86);
	const threshold = foregroundThreshold(lowLuma, highLuma);
	const active = findActiveBounds(plane, threshold);
	const crop = conservativeCrop(plane, active);
	const foregroundPermille = Math.round((active.foreground / total) * 1000);
	const cropArea = (crop.right - crop.left) * (crop.bottom - crop.top);
	const retainedAreaPermille = Math.max(1, Math.min(1000, Math.round((cropArea / total) * 1000)));
	const range = highLuma - lowLuma;
	const contrastEnhanced = range >= 35 && range < 205 && (lowLuma > 18 || highLuma < 238);
	const illuminationNormalized =
		backgroundLuma >= 158 && foregroundPermille >= 8 && backgroundVariation(plane) >= 18;
	const deskewMilliDegrees =
		foregroundPermille >= 8 && foregroundPermille <= 650
			? deskew(plane, threshold, crop)
			: 0;

	return Object.freeze({
		cropLeft: crop.left,
		cropTop: crop.top,
		cropRight: crop.right,
		cropBottom: crop.bottom,
		autoCropApplied: crop.applied,
		retainedAreaPermille,
		deskewMilliDegrees,
		contrastEnhanced,
		illuminationNormalized,
		lowLuma,
		highLuma,
		backgroundLuma,
		foregroundPermille
	});
}
