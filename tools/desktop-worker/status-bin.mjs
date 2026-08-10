#!/usr/bin/env node

import process from 'node:process';
import { inspectWorkerStatus } from './status.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

if (process.argv.length !== 2) {
	process.stderr.write('Usage: fichario-worker-status\n');
	process.exitCode = 2;
} else {
	try {
		const status = await inspectWorkerStatus();
		process.stdout.write(`${JSON.stringify(status)}\n`);
	} catch (error) {
		const code =
			typeof error?.code === 'string' && SAFE_CODE.test(error.code)
				? error.code
				: 'worker_status_failed';
		process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
		process.exitCode = 1;
	}
}
