import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const forbidden = [
	/\bwindow\s*\.\s*confirm\s*\(/,
	/\bglobalThis\s*\.\s*confirm\s*\(/,
	/\bwindow\s*\.\s*prompt\s*\(/,
	/\bglobalThis\s*\.\s*prompt\s*\(/,
	/\bwindow\s*\.\s*alert\s*\(/,
	/\bglobalThis\s*\.\s*alert\s*\(/
];

function sourceFiles(directory = sourceRoot): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(?:svelte|ts|js|mjs)$/.test(entry.name) ? [path] : [];
	});
}

describe('first-party interaction windows', () => {
	it('does not use browser-native alert, confirm or prompt dialogs in application source', () => {
		for (const file of sourceFiles()) {
			const source = readFileSync(file, 'utf8');
			for (const pattern of forbidden) {
				expect(source, `${relative(process.cwd(), file)} uses ${pattern}`).not.toMatch(pattern);
			}
		}
	});
});
