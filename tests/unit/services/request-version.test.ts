import { describe, expect, it } from 'vitest';
import { RequestVersion } from '../../../src/lib/services/request-version';

describe('RequestVersion', () => {
	it('invalidates earlier requests when a new generation starts', () => {
		const requests = new RequestVersion();
		const first = requests.next();
		const second = requests.next();

		expect(first).toBe(1);
		expect(second).toBe(2);
		expect(requests.isCurrent(first)).toBe(false);
		expect(requests.isCurrent(second)).toBe(true);
	});

	it('lets pagination share the active filter generation', () => {
		const requests = new RequestVersion();
		const filterGeneration = requests.next();

		expect(requests.current()).toBe(filterGeneration);
		expect(requests.isCurrent(requests.current())).toBe(true);
	});
});
