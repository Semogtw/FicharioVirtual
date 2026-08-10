import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function fail(message) {
	throw new Error(`Cloudflare Pages deployment output failed validation: ${message}`);
}

function cleanHttpsOrigin(value, label) {
	if (typeof value !== 'string' || value.trim() === '') fail(`${label} is missing`);
	let url;
	try {
		url = new URL(value);
	} catch {
		fail(`${label} is not a valid URL`);
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		fail(`${label} must be a clean HTTPS origin`);
	}
	return url.origin;
}

export function validatePagesDeployOutput(source, expected) {
	if (typeof source !== 'string' || source.trim() === '') fail('Wrangler output is empty');
	if (!expected || typeof expected !== 'object') fail('expected deployment identity is missing');
	if (expected.project !== 'fichario-virtual') fail('expected project must be fichario-virtual');
	if (!['preview', 'production'].includes(expected.environment)) {
		fail('expected environment must be preview or production');
	}
	if (expected.productionBranch !== 'main') fail('expected production branch must be main');
	if (!/^[0-9a-f]{40}$/.test(expected.commitHash ?? '')) fail('expected source SHA is invalid');

	const entries = [];
	for (const [index, line] of source.split(/\r?\n/).entries()) {
		if (line.trim() === '') continue;
		try {
			entries.push(JSON.parse(line));
		} catch {
			fail(`Wrangler output line ${index + 1} is not valid JSON`);
		}
	}

	const deployments = entries.filter((entry) => entry?.type === 'pages-deploy-detailed');
	if (deployments.length !== 1) {
		fail(`expected exactly one pages-deploy-detailed record, received ${deployments.length}`);
	}
	const deployment = deployments[0];
	if (deployment.pages_project !== expected.project) fail('Pages project does not match');
	if (deployment.environment !== expected.environment)
		fail('deployment environment does not match');
	if (deployment.production_branch !== expected.productionBranch) {
		fail('production branch does not match');
	}
	if (deployment.deployment_trigger?.metadata?.commit_hash !== expected.commitHash) {
		fail('deployment source SHA does not match');
	}
	if (!/^[0-9a-f-]{16,}$/i.test(deployment.deployment_id ?? '')) {
		fail('deployment ID is invalid');
	}

	const url = cleanHttpsOrigin(deployment.url, 'deployment URL');
	const hostname = new URL(url).hostname;
	if (!hostname.endsWith('.fichario-virtual.pages.dev')) {
		fail('deployment URL is outside the expected Pages project');
	}

	let alias = '';
	if (deployment.alias !== undefined && deployment.alias !== null && deployment.alias !== '') {
		alias = cleanHttpsOrigin(deployment.alias, 'deployment alias');
		const aliasHostname = new URL(alias).hostname;
		if (
			aliasHostname !== 'fichario-virtual.pages.dev' &&
			!aliasHostname.endsWith('.fichario-virtual.pages.dev')
		) {
			fail('deployment alias is outside the expected Pages project');
		}
	}

	return Object.freeze({
		url,
		alias,
		deploymentId: deployment.deployment_id
	});
}

function runCli() {
	const outputPath = process.env.WRANGLER_OUTPUT_FILE_PATH;
	const targetEnvironment = process.env.TARGET_ENVIRONMENT;
	const commitHash = process.env.EXPECTED_SOURCE_COMMIT;
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (!outputPath) fail('WRANGLER_OUTPUT_FILE_PATH is missing');
	if (!githubOutput) fail('GITHUB_OUTPUT is missing');
	const environment = targetEnvironment === 'production' ? 'production' : 'preview';
	const result = validatePagesDeployOutput(readFileSync(outputPath, 'utf8'), {
		project: 'fichario-virtual',
		environment,
		productionBranch: 'main',
		commitHash
	});
	appendFileSync(
		githubOutput,
		`url=${result.url}\ndeployment_id=${result.deploymentId}\nalias=${result.alias}\n`
	);
	console.log(
		`Cloudflare Pages deployment identity: PASS (${result.deploymentId}, ${result.url}, ${commitHash})`
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		runCli();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
