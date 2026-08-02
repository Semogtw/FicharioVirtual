export type HashInput = Blob | ArrayBuffer | ArrayBufferView;

async function copyBytes(input: HashInput): Promise<Uint8Array> {
	if (input instanceof Blob) {
		return new Uint8Array(await input.arrayBuffer());
	}
	if (input instanceof ArrayBuffer) {
		return new Uint8Array(input.slice(0));
	}
	return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
}

export async function calculateSha256(input: HashInput): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('SHA-256 is unavailable in this runtime');

	const bytes = await copyBytes(input);
	try {
		const digest = await subtle.digest('SHA-256', bytes);
		return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
			''
		);
	} finally {
		bytes.fill(0);
	}
}
