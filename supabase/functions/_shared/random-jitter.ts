const JITTER_VALUES = 1000;
const UINT32_RANGE = 0x1_0000_0000;
const BUCKET_SIZE = Math.floor(UINT32_RANGE / JITTER_VALUES);
const ACCEPTED_RANGE = BUCKET_SIZE * JITTER_VALUES;

export function randomJitterMs(): number {
	const sample = new Uint32Array(1);
	while (true) {
		crypto.getRandomValues(sample);
		const value = sample[0];
		if (value < ACCEPTED_RANGE) return Math.floor(value / BUCKET_SIZE);
	}
}
