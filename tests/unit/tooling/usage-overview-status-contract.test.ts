import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

function quotedValues(source: string) {
	return [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('usage overview processing status contract', () => {
	it('uses only processing_status enum values in the bootstrap migration', () => {
		const schema = read('supabase/migrations/202608020002_schema.sql');
		const usageOverview = read('supabase/migrations/202608020013_usage_overview.sql');
		const enumBody = schema.match(/create type public\.processing_status as enum \(([\s\S]*?)\);/);

		expect(enumBody).not.toBeNull();
		const allowedStatuses = new Set(quotedValues(enumBody?.[1] ?? ''));
		const statusPredicates = [
			...usageOverview.matchAll(/p\.status\s+in\s+\(([^)]*)\)/g),
			...usageOverview.matchAll(/p\.status\s*=\s*('[^']+')/g)
		];

		expect(statusPredicates.length).toBeGreaterThan(0);
		for (const predicate of statusPredicates) {
			for (const status of quotedValues(predicate[1] ?? '')) {
				expect(allowedStatuses, `invalid processing_status value: ${status}`).toContain(status);
			}
		}
	});
});
