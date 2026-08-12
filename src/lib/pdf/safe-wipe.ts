export function safelyWipeBytes(bytes: Uint8Array | null | undefined): void {
	if (!bytes) return;
	try {
		if (bytes.byteLength > 0) bytes.fill(0);
	} catch (error) {
		// WASM may detach/transfer its input ArrayBuffer. In that state there is
		// no writable JS view left to clear, and cleanup must never turn a
		// successful PDF inspection into an import failure.
		if (error instanceof TypeError) return;
		throw error;
	}
}
