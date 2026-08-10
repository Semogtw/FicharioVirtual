#!/usr/bin/env node

import process from 'node:process';
import { initializeWorkerConfig } from './config-setup.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
const [appOrigin, ...extra] = process.argv.slice(2);

if (typeof appOrigin !== 'string' || appOrigin.length === 0 || extra.length > 0) {
	process.stderr.write('Usage: fichario-worker-config <https-app-origin>\n');
	process.exitCode = 2;
} else {
	try {
		const result = await initializeWorkerConfig(appOrigin);
		process.stdout.write(
			`${JSON.stringify({ status: 'created', appOrigin: result.config.appOrigin })}\n`
		);
	} catch (error) {
		const code =
			typeof error?.code === 'string' && SAFE_CODE.test(error.code)
				? error.code
				: 'worker_config_setup_failed';
		process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
		process.exitCode = 1;
	}
}
