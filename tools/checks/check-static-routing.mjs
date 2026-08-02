import process from 'node:process';
import { handleUnseenClientRoutes } from '../config/prerender-policy.mjs';

const allowedRoutes = ['/documents/[id]', '/notebooks/[id]'];
const failures = [];

function fail(detail) {
	failures.push(detail);
}

try {
	handleUnseenClientRoutes({
		routes: [...allowedRoutes],
		message: 'expected client-only routes were unseen'
	});
} catch (error) {
	fail(
		`known client-only routes must be accepted: ${error instanceof Error ? error.message : String(error)}`
	);
}

try {
	handleUnseenClientRoutes({
		routes: [...allowedRoutes].reverse(),
		message: 'route order must not matter'
	});
} catch (error) {
	fail(
		`known route order must not matter: ${error instanceof Error ? error.message : String(error)}`
	);
}

for (const routes of [
	['/documents/[id]'],
	['/documents/[id]', '/unexpected/[slug]'],
	[],
	['/documents/[id]', '/notebooks/[id]', '/unexpected']
]) {
	let threw = false;
	try {
		handleUnseenClientRoutes({ routes, message: 'strict prerender failure' });
	} catch (error) {
		threw = true;
		if (!(error instanceof Error) || !error.message.includes('strict prerender failure')) {
			fail(`unexpected route set ${JSON.stringify(routes)} must preserve the SvelteKit message`);
		}
	}
	if (!threw) fail(`unexpected route set ${JSON.stringify(routes)} must fail the build`);
}

if (failures.length > 0) {
	console.error(`Static routing checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Static routing checks passed for the exact client-only dynamic route allowlist.');
}
