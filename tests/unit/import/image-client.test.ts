import { describe, expect, it } from 'vitest';
import {
	ImagePreparationClient,
	type ImageWorkerLike
} from '../../../src/lib/import/image-client';
import type { ImageWorkerRequest, ImageWorkerResponse } from '../../../src/lib/import/image-types';

class FakeWorker implements ImageWorkerLike {
	onmessage: ((event: MessageEvent<ImageWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	request: ImageWorkerRequest | null = null;
	terminated = false;

	postMessage(request: ImageWorkerRequest) {
		this.request = request;
	}

	terminate() {
		this.terminated = true;
	}

	succeed() {
		if (!this.request) throw new Error('Worker was not started');
		this.onmessage?.({
			data: {
				type: 'success',
				id: this.request.id,
				image: new Blob(['prepared'], { type: 'image/webp' }),
				thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
				width: 1600,
				height: 1200,
				format: 'image/webp'
			}
		} as MessageEvent<ImageWorkerResponse>);
	}
}

function image(name: string) {
	return new File(['image'], name, { type: 'image/jpeg' });
}

describe('ImagePreparationClient', () => {
	it('uses the standard preparation profile by default', async () => {
		const workers: FakeWorker[] = [];
		const client = new ImagePreparationClient(() => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		});

		const pending = client.prepare(image('page.jpg'));
		expect(workers[0]?.request).toEqual(
			expect.objectContaining({
				maxDimension: 2560,
				thumbnailDimension: 480,
				quality: 0.85
			})
		);
		workers[0]?.succeed();

		await expect(pending).resolves.toEqual(
			expect.objectContaining({
				width: 1600,
				height: 1200,
				format: 'image/webp',
				originalName: 'page.jpg'
			})
		);
		expect(workers[0]?.terminated).toBe(true);
	});

	it('runs no more than two preparation workers at once', async () => {
		const workers: FakeWorker[] = [];
		const client = new ImagePreparationClient(
			() => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			2
		);

		const first = client.prepare(image('one.jpg'));
		const second = client.prepare(image('two.jpg'));
		const third = client.prepare(image('three.jpg'));

		expect(workers).toHaveLength(2);
		workers[0]?.succeed();
		await first;
		await Promise.resolve();
		expect(workers).toHaveLength(3);

		workers[1]?.succeed();
		workers[2]?.succeed();
		await Promise.all([second, third]);
	});

	it('cancels a queued task without starting another worker', async () => {
		const workers: FakeWorker[] = [];
		const client = new ImagePreparationClient(
			() => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker;
			},
			1
		);
		const controller = new AbortController();
		const active = client.prepare(image('active.jpg'));
		const cancelled = client.prepare(image('cancelled.jpg'), 'standard', {
			signal: controller.signal
		});

		controller.abort();
		await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
		expect(workers).toHaveLength(1);

		workers[0]?.succeed();
		await active;
		expect(workers).toHaveLength(1);
	});
});
