type RecentImportCompletionOptions = Readonly<{
	ttlMs?: number;
	maxEntries?: number;
	now?: () => number;
}>;

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 512;

function positiveInteger(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`${name} must be a positive safe integer`);
	}
	return value;
}

export class RecentImportCompletions {
	private readonly entries = new Map<string, number>();
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly now: () => number;

	constructor(options: RecentImportCompletionOptions = {}) {
		this.ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs');
		this.maxEntries = positiveInteger(
			options.maxEntries ?? DEFAULT_MAX_ENTRIES,
			'maxEntries'
		);
		this.now = options.now ?? Date.now;
	}

	remember(id: string) {
		const now = this.now();
		this.pruneExpired(now);
		this.entries.delete(id);
		this.entries.set(id, now + this.ttlMs);
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	has(id: string) {
		const expiresAt = this.entries.get(id);
		if (expiresAt === undefined) return false;
		if (expiresAt <= this.now()) {
			this.entries.delete(id);
			return false;
		}
		return true;
	}

	forget(id: string) {
		this.entries.delete(id);
	}

	private pruneExpired(now: number) {
		for (const [id, expiresAt] of this.entries) {
			if (expiresAt <= now) this.entries.delete(id);
		}
	}
}
