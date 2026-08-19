import { describe, expect, it, vi } from 'vitest';
import { reloadOnServiceWorkerUpdate } from '../../../src/lib/pwa/service-worker-update';

describe('service-worker update reload', () => {
	it('does not subscribe on a first visit without an active controller', () => {
		const subscribe = vi.fn();
		const reload = vi.fn();

		expect(reloadOnServiceWorkerUpdate(false, subscribe, reload)).toBe(false);
		expect(subscribe).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});

	it('reloads an already-controlled page once when a new worker takes control', () => {
		let controllerChange: (() => void) | undefined;
		const subscribe = vi.fn((listener: () => void) => {
			controllerChange = listener;
		});
		const reload = vi.fn();

		expect(reloadOnServiceWorkerUpdate(true, subscribe, reload)).toBe(true);
		expect(subscribe).toHaveBeenCalledOnce();

		controllerChange?.();
		controllerChange?.();

		expect(reload).toHaveBeenCalledOnce();
	});
});
