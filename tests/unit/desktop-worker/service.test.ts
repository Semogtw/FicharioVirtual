import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
	createProcessShutdownSignal,
	runDesktopWorkerService
} from '../../../tools/desktop-worker/service.mjs';

class FakeProcess extends EventEmitter {}

describe('runDesktopWorkerService', () => {
	it('creates the locked engine, runtime and loop then closes runtime exactly once', async () => {
		const paths = { configDir: '/tmp/fichario-worker' };
		const engine = { process: vi.fn() };
		const createEngine = vi.fn(async () => engine);
		const runtime = {
			context: { client: {}, spool: {}, engine, downloadsDir: '/tmp/downloads' },
			config: {
				pollIntervalSeconds: 30,
				idlePollIntervalSeconds: 300,
				keepCompletedSpoolHours: 24
			},
			close: vi.fn()
		};
		const createRuntime = vi.fn(async () => runtime);
		const onStatus = vi.fn();
		const runLoop = vi.fn(async (_context, _config, options) => {
			await options.onStatus({ cycle: 1, status: 'idle', consecutiveFailures: 0, code: null });
			return { cycles: 1, consecutiveFailures: 0 };
		});

		const result = await runDesktopWorkerService({
			paths,
			createEngine,
			createRuntime,
			runLoop,
			onStatus
		});

		expect(createEngine).toHaveBeenCalledWith(paths);
		expect(createRuntime).toHaveBeenCalledWith({ engine, paths }, { signal: undefined });
		expect(runLoop).toHaveBeenCalledWith(runtime.context, runtime.config, {
			signal: undefined,
			onStatus
		});
		expect(onStatus).toHaveBeenCalledWith({
			cycle: 1,
			status: 'idle',
			consecutiveFailures: 0,
			code: null
		});
		expect(result).toEqual({ status: 'stopped', cycles: 1, consecutiveFailures: 0 });
		expect(runtime.close).toHaveBeenCalledOnce();
	});

	it('reports only a safe coded setup failure and never forwards the original message', async () => {
		const onError = vi.fn();
		const error = Object.assign(new Error('credential AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked'), {
			code: 'worker_credential_missing'
		});

		const result = await runDesktopWorkerService({
			paths: { configDir: '/tmp/fichario-worker' },
			createEngine: vi.fn(async () => {
				throw error;
			}),
			createRuntime: vi.fn(),
			runLoop: vi.fn(),
			onError
		});

		expect(result).toEqual({ status: 'failed', code: 'worker_credential_missing' });
		expect(onError).toHaveBeenCalledWith({ status: 'failed', code: 'worker_credential_missing' });
		expect(JSON.stringify(onError.mock.calls)).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
	});

	it('uses a generic failure code for unsafe or malformed error codes', async () => {
		const onError = vi.fn();
		const error = Object.assign(new Error('private path /home/user/document.webp'), {
			code: 'BAD CODE /home/user'
		});

		const result = await runDesktopWorkerService({
			paths: { configDir: '/tmp/fichario-worker' },
			createEngine: vi.fn(async () => {
				throw error;
			}),
			createRuntime: vi.fn(),
			runLoop: vi.fn(),
			onError
		});

		expect(result).toEqual({ status: 'failed', code: 'worker_service_failed' });
		expect(onError).toHaveBeenCalledWith({ status: 'failed', code: 'worker_service_failed' });
	});

	it('treats caller cancellation as a clean stop and still closes runtime', async () => {
		const controller = new AbortController();
		const runtime = { context: {}, config: {}, close: vi.fn() };
		const onError = vi.fn();
		const result = await runDesktopWorkerService(
			{
				paths: { configDir: '/tmp/fichario-worker' },
				createEngine: vi.fn(async () => ({ process: vi.fn() })),
				createRuntime: vi.fn(async () => runtime),
				runLoop: vi.fn(async () => {
					controller.abort(new DOMException('shutdown', 'AbortError'));
					throw controller.signal.reason;
				}),
				onError
			},
			{ signal: controller.signal }
		);

		expect(result).toEqual({
			status: 'stopped',
			cycles: null,
			consecutiveFailures: null
		});
		expect(onError).not.toHaveBeenCalled();
		expect(runtime.close).toHaveBeenCalledOnce();
	});
});

describe('createProcessShutdownSignal', () => {
	it('aborts once on SIGTERM and removes both listeners on close', () => {
		const processObject = new FakeProcess();
		const shutdown = createProcessShutdownSignal(processObject);
		const abort = vi.fn();
		shutdown.signal.addEventListener('abort', abort);

		processObject.emit('SIGTERM');
		processObject.emit('SIGINT');

		expect(shutdown.signal.aborted).toBe(true);
		expect(shutdown.signal.reason).toMatchObject({ name: 'AbortError' });
		expect(abort).toHaveBeenCalledOnce();
		expect(processObject.listenerCount('SIGTERM')).toBe(0);
		expect(processObject.listenerCount('SIGINT')).toBe(1);

		shutdown.close();
		shutdown.close();
		expect(processObject.listenerCount('SIGTERM')).toBe(0);
		expect(processObject.listenerCount('SIGINT')).toBe(0);
	});

	it('also supports SIGINT as the first shutdown signal', () => {
		const processObject = new FakeProcess();
		const shutdown = createProcessShutdownSignal(processObject);
		processObject.emit('SIGINT');
		expect(shutdown.signal.aborted).toBe(true);
		expect(String(shutdown.signal.reason)).toContain('SIGINT');
		shutdown.close();
	});
});
