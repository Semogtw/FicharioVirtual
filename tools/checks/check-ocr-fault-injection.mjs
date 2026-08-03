#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const vitestCli = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
const suite = resolve(repositoryRoot, 'tests/unit/integration/ocr-fault-injection.test.ts');
const result = spawnSync(process.execPath, [vitestCli, 'run', suite], {
	cwd: repositoryRoot,
	stdio: 'inherit',
	env: { ...process.env, NO_COLOR: '1' }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('OCR local fault injection: PASS (7 scenarios, loopback only)');
