#!/usr/bin/env node

import process from 'node:process';
import { runWorkerDoctor } from './doctor.mjs';

if (process.argv.length !== 2) {
	process.stderr.write('Usage: fichario-worker-doctor\n');
	process.exitCode = 2;
} else {
	try {
		const result = await runWorkerDoctor();
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (!result.ready) process.exitCode = 1;
	} catch (error) {
		if (error?.name === 'AbortError') {
			process.exitCode = 130;
		} else {
			process.stderr.write(
				`${JSON.stringify({ status: 'failed', code: 'worker_doctor_failed' })}\n`
			);
			process.exitCode = 1;
		}
	}
}
