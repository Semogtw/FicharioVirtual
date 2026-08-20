type TauriCore = Readonly<{
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}>;

type TauriGlobal = typeof globalThis & {
	__TAURI__?: Readonly<{ core?: TauriCore }>;
};

export class NativeRuntimeUnavailableError extends Error {
	constructor() {
		super('O runtime nativo do Fichário não está disponível.');
		this.name = 'NativeRuntimeUnavailableError';
	}
}

function nativeCore(): TauriCore | null {
	const core = (globalThis as TauriGlobal).__TAURI__?.core;
	return core && typeof core.invoke === 'function' ? core : null;
}

export function isNativeRuntime() {
	return nativeCore() !== null;
}

export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const core = nativeCore();
	if (!core) throw new NativeRuntimeUnavailableError();
	return await core.invoke<T>(command, args);
}
