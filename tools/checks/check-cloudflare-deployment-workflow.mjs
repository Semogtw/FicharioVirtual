import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = resolve(root, '.github/workflows/deploy-cloudflare-pages.yml');
const source = await readFile(workflowPath, 'utf8');
const failures = [];

function requirePattern(pattern, detail) {
	if (!pattern.test(source)) failures.push(detail);
}

function forbidPattern(pattern, detail) {
	if (pattern.test(source)) failures.push(detail);
}

requirePattern(/^on:\s*\n\s+workflow_dispatch:\s*$/mu, 'workflow must remain manual-only');
requirePattern(
	/^permissions:\s*\n\s+actions:\s*read\s*\n\s+contents:\s*read\s*$/mu,
	'workflow permissions must remain actions:read + contents:read'
);
requirePattern(
	/^\s+environment:\s*\$\{\{ inputs\.target_environment == 'production' && 'production-deploy' \|\| 'staging-deploy' \}\}\s*$/mu,
	'deployment job must isolate staging-deploy from production-deploy'
);
requirePattern(
	/^\s+CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}\s*$/mu,
	'Cloudflare API token must come only from the protected deploy environment'
);
requirePattern(
	/^\s+CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}\s*$/mu,
	'Cloudflare account ID must come only from the protected deploy environment'
);
requirePattern(
	/^\s+CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED:\s*\$\{\{ vars\.CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED \}\}\s*$/mu,
	'production promotion must use an explicit protected-environment enable flag'
);
requirePattern(
	/CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED\" != 'true'/u,
	'production promotion must fail closed until explicitly enabled'
);
requirePattern(
	/^\s+WRANGLER_VERSION:\s*'\d+\.\d+\.\d+'\s*$/mu,
	'Wrangler must remain pinned to an explicit version'
);
requirePattern(
	/^\s+WRANGLER_OUTPUT_FILE_PATH:\s*\/tmp\/wrangler-pages-output\.jsonl\s*$/mu,
	'Wrangler structured deployment output must be captured'
);
requirePattern(
	/actions\/download-artifact@[0-9a-f]{40}/u,
	'artifact download action must remain pinned to a full commit SHA'
);
requirePattern(
	/name:\s*fichario-static-\$\{\{ inputs\.expected_source_commit \}\}-\$\{\{ inputs\.target_environment \}\}/u,
	'artifact identity must bind source SHA and target environment'
);
requirePattern(
	/run-id:\s*\$\{\{ inputs\.artifact_run_id \}\}/u,
	'artifact must be downloaded from the explicitly selected build run'
);
requirePattern(
	/checks\/check-deployed-site\.mjs checks\/deployment-contract\.mjs/u,
	'artifact verification must require the pinned post-deploy checker and contract'
);
requirePattern(
	/\^\[0-9a-f\]\{40\}\$/u,
	'expected source SHA must be validated as a full lowercase Git SHA'
);
requirePattern(/manifest_value source_commit/u, 'artifact manifest source SHA must be verified');
requirePattern(
	/manifest_value target_environment/u,
	'artifact manifest target environment must be verified'
);
requirePattern(/sha256sum -c SHA256SUMS/u, 'artifact checksums must be revalidated before deployment');
requirePattern(/find \"\$artifact_root\" -type l/u, 'artifact symlinks must be rejected');
requirePattern(
	/wrangler pages deploy \"\$ARTIFACT_ROOT\/site\"/u,
	'only the validated site directory may be deployed'
);
requirePattern(
	/--project-name=fichario-virtual/u,
	'deployment must remain scoped to the Fichário Pages project'
);
requirePattern(
	/--commit-hash=\"\$EXPECTED_SOURCE_COMMIT\"/u,
	'Cloudflare deployment metadata must retain the validated source SHA'
);
requirePattern(/pages_branch='main'/u, 'production deployments must target the production branch');
requirePattern(/pages_branch='staging'/u, 'staging deployments must target a preview branch');
requirePattern(
	/entry\.type === 'pages-deploy-detailed'/u,
	'workflow must consume Wrangler structured Pages deployment output'
);
requirePattern(
	/deployment\.deployment_trigger\?\.metadata\?\.commit_hash !== process\.env\.EXPECTED_SOURCE_COMMIT/u,
	'workflow must verify the source SHA returned by Cloudflare'
);
requirePattern(
	/node \"\$ARTIFACT_ROOT\/checks\/check-deployed-site\.mjs\" \"\$DEPLOYMENT_URL\"/u,
	'exact deployment URL must pass the checker carried by the artifact'
);
requirePattern(
	/node \"\$ARTIFACT_ROOT\/checks\/check-deployed-site\.mjs\" 'https:\/\/fichario-virtual\.pages\.dev'/u,
	'production alias must pass the same artifact-pinned checker'
);

forbidPattern(/actions\/checkout@/u, 'deployment workflow must not checkout or rebuild source');
forbidPattern(
	/\bpnpm\s+(?:install|build|verify)\b/u,
	'deployment workflow must not install or rebuild application source'
);
forbidPattern(
	/wrangler pages project create/u,
	'deployment workflow must not create or replace the Pages project'
);
forbidPattern(
	/https:\/\/staging\.fichario-virtual\.pages\.dev/u,
	'staging verification must use Wrangler exact deployment output instead of an assumed alias'
);

if (failures.length > 0) {
	console.error(`Cloudflare deployment workflow checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Cloudflare deployment workflow checks passed.');
}
