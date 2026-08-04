import { describe, expect, it, vi } from 'vitest';
import { createOcrQueueLifecycle } from '../../../src/lib/import/job-runner-lifecycle';

class FakeTarget {
	private readonly listeners = new Map<string, Set<() => void>>();

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? new Set<() => void>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: () => void) {
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: string) {
		for (const listener of this.listeners.get(type) ?? []) listener();
	}

	count(type: string) {
		return this.listeners.get(type)?.size ?? 0;
	}
}

function setup() {
	const onlineTarget = new FakeTarget();
	const visibilityTarget = new FakeTarget();
	let visible = true;
	let online = true;
	let poll: (() => void) | undefined;
	const clearInterval = vi.fn();
	const resume = vi.fn(async () => undefined);
	const lifecycle = createOcrQueueLifecycle(resume, {
		onlineTarget,
		visibilityTarget,
		visibilityState: () => (visible ? 'visible' : 'hidden'),
		isOnline: () => online,
		setInterval: vi.fn((callback, milliseconds) => {
			expect(milliseconds).toBe(5 * 60_000);
			poll = callback;
			return 11 as unknown as ReturnType<typeof setInterval>;
		}),
		clearInterval
	});
	return {
		lifecycle,
		resume,
		onlineTarget,
		visibilityTarget,
		clearInterval,
		poll: () => poll?.(),
		setVisible(value: boolean) {
			visible = value;
		},
		setOnline(value: boolean) {
			online = value;
		}
	};
}

describe('OCR queue browser lifecycle', () => {
	it('starts once and immediately resumes the queue', () => {
		const state = setup();

		state.lifecycle.start();
		state.lifecycle.start();

		expect(state.resume).toHaveBeenCalledOnce();
		expect(state.onlineTarget.count('online')).toBe(1);
		expect(state.visibilityTarget.count('visibilitychange')).toBe(1);
	});

	it('resumes after connectivity and visible-tab events', () => {
		const state = setup();
		state.lifecycle.start();
		state.resume.mockClear();

		state.onlineTarget.emit('online');
		state.setVisible(false);
		state.visibilityTarget.emit('visibilitychange');
		state.setVisible(true);
		state.visibilityTarget.emit('visibilitychange');

		expect(state.resume).toHaveBeenCalledTimes(2);
	});

	it('polls only while the tab is visible and online', () => {
		const state = setup();
		state.lifecycle.start();
		state.resume.mockClear();

		state.poll();
		state.setVisible(false);
		state.poll();
		state.setVisible(true);
		state.setOnline(false);
		state.poll();

		expect(state.resume).toHaveBeenCalledOnce();
	});

	it('removes listeners and polling when stopped', () => {
		const state = setup();
		state.lifecycle.start();
		state.resume.mockClear();

		state.lifecycle.stop();
		state.lifecycle.stop();
		state.onlineTarget.emit('online');
		state.visibilityTarget.emit('visibilitychange');
		state.poll();

		expect(state.resume).not.toHaveBeenCalled();
		expect(state.onlineTarget.count('online')).toBe(0);
		expect(state.visibilityTarget.count('visibilitychange')).toBe(0);
		expect(state.clearInterval).toHaveBeenCalledOnce();
	});

	it('contains resume failures so later events can retry', async () => {
		const state = setup();
		state.resume.mockRejectedValueOnce(new Error('offline'));

		state.lifecycle.start();
		await Promise.resolve();
		state.onlineTarget.emit('online');
		await Promise.resolve();

		expect(state.resume).toHaveBeenCalledTimes(2);
	});
});
