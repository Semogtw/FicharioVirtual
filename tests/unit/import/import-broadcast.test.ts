import { describe, expect, it, vi } from 'vitest';
import {
	ImportBroadcastCoordinator,
	type ImportBroadcastChannel
} from '../../../src/lib/import/import-broadcast';

class FakeChannel implements ImportBroadcastChannel {
	listener: ((event: MessageEvent<unknown>) => void) | null = null;
	postMessage = vi.fn();
	close = vi.fn();

	addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
		this.listener = listener;
	}

	removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
		if (this.listener === listener) this.listener = null;
	}

	emit(data: unknown) {
		this.listener?.({ data } as MessageEvent<unknown>);
	}
}

describe('ImportBroadcastCoordinator', () => {
	it('publishes updates without dispatching them to the same coordinator', () => {
		const channel = new FakeChannel();
		const listener = vi.fn();
		const broadcasts = new ImportBroadcastCoordinator(channel);
		broadcasts.subscribe(listener);

		broadcasts.publish({ type: 'image-import-updated', id: 'item-1', status: 'complete' });

		expect(channel.postMessage).toHaveBeenCalledWith({
			type: 'image-import-updated',
			id: 'item-1',
			status: 'complete'
		});
		expect(listener).not.toHaveBeenCalled();
	});

	it('dispatches only strict import update messages', () => {
		const channel = new FakeChannel();
		const listener = vi.fn();
		const broadcasts = new ImportBroadcastCoordinator(channel);
		broadcasts.subscribe(listener);

		channel.emit({ type: 'pdf-import-updated', id: 'pdf-1', status: 'needs_review' });
		channel.emit({ type: 'pdf-import-updated', id: 'pdf-1', status: 'complete', extra: true });
		channel.emit({ type: 'unknown', id: 'pdf-1', status: 'complete' });
		channel.emit({ type: 'pdf-import-updated', id: '../pdf', status: 'complete' });

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({
			type: 'pdf-import-updated',
			id: 'pdf-1',
			status: 'needs_review'
		});
	});

	it('isolates subscriber failures so later listeners still receive the update', () => {
		const channel = new FakeChannel();
		const onListenerError = vi.fn();
		const broadcasts = new ImportBroadcastCoordinator(channel, onListenerError);
		const error = new Error('subscriber failed');
		const first = vi.fn(() => {
			throw error;
		});
		const second = vi.fn();
		broadcasts.subscribe(first);
		broadcasts.subscribe(second);

		channel.emit({ type: 'image-import-updated', id: 'image_1', status: 'complete' });

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith({
			type: 'image-import-updated',
			id: 'image_1',
			status: 'complete'
		});
		expect(onListenerError).toHaveBeenCalledWith(error);
	});

	it('unsubscribes and closes the underlying channel', () => {
		const channel = new FakeChannel();
		const listener = vi.fn();
		const broadcasts = new ImportBroadcastCoordinator(channel);
		const unsubscribe = broadcasts.subscribe(listener);

		unsubscribe();
		channel.emit({ type: 'image-import-updated', id: 'item-1', status: 'complete' });
		broadcasts.close();

		expect(listener).not.toHaveBeenCalled();
		expect(channel.listener).toBeNull();
		expect(channel.close).toHaveBeenCalledOnce();
	});
});
