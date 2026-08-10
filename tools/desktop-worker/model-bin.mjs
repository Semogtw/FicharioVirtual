#!/usr/bin/env node

import process from 'node:process';
import { lockLocalOllamaModel } from './model-setup.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
const [model, ...extra] = process.argv.slice(2);

if (typeof model !== 'string' || model.length === 0 || extra.length > 0) {
	process.stderr.write('Usage: fichario-worker-model <local-ollama-model>\n');
	process.exitCode = 2;
} else {
	try {
		const lock = await lockLocalOllamaModel(model);
		process.stdout.write(
			`${JSON.stringify({ status: 'locked', backend: lock.backend, model: lock.model, digest: lock.digest })}\n`
		);
	} catch (error) {
		const code =
			typeof error?.code === 'string' && SAFE_CODE.test(error.code)
				? error.code
				: 'worker_model_setup_failed';
		process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
		process.exitCode = 1;
	}
}
