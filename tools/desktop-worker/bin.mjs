#!/usr/bin/env node

import process from 'node:process';
import { createProcessShutdownSignal, runDesktopWorkerService } from './service.mjs';

function writeStatus(stream, value) {
	stream.write(`${JSON.stringify(value)}\n`);
}

const shutdown = createProcessShutdownSignal(process);
try {
	const result = await runDesktopWorkerService(
		{
			onStatus(status) {
				writeStatus(process.stdout, status);
			},
			onError(status) {
				writeStatus(process.stderr, status);
			}
		},
		{ signal: shutdown.signal }
	);
	if (result.status === 'failed') process.exitCode = 1;
} finally {
	shutdown.close();
}
