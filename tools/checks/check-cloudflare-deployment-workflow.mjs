import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = resolve(root, '.github/workflows/deploy-cloudflare-pages.yml');
const source = await readFile(workflowPath, 'utf8');
const failures = [];

function requireText(text, detail) {
	if (!source.includes(text)) failures.push(detail);
}

function forbidText(text, detail) {
	if (source.includes(text)) failures.push(detail);
}

requireText(
	'on:\n  workflow_dispatch:',
	'workflow must retain an explicit manual recovery trigger'
);
requireText(
	'  workflow_run:\n    workflows:\n      - Build deployable Fichário staging artifact\n    types:\n      - completed',
	'automatic deploys must be triggered only by completion of the reviewed artifact workflow'
);
forbidText('\n  push:', 'deployment workflow must not deploy directly on push');
forbidText('\n  pull_request:', 'workflow must not deploy on pull requests');
forbidText('\n  schedule:', 'workflow must not deploy on a schedule');
requireText(
	"github.event.workflow_run.conclusion == 'success'",
	'automatic deployment must require a successful artifact workflow conclusion'
);
requireText(
	"github.event.workflow_run.head_branch == 'main'",
	'automatic deployment must accept artifact workflow runs from main only'
);
requireText(
	"EXPECTED_SOURCE_COMMIT: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.expected_source_commit }}",
	'deployment source SHA must bind to the triggering build SHA or the explicit recovery input'
);
requireText(
	"ARTIFACT_RUN_ID: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.id || inputs.artifact_run_id }}",
	'deployment artifact run must bind to the triggering build run or the explicit recovery input'
);
requireText(
	'permissions:\n  actions: read\n  contents: read',
	'workflow permissions must remain actions:read + contents:read'
);
requireText(
	'environment: staging-deploy',
	'deployment must use only the existing staging-deploy environment'
);
requireText('TARGET_ENVIRONMENT: staging', 'deployment target must remain hard-coded to staging');
requireText(
	'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
	'Cloudflare API token must come from staging-deploy'
);
requireText(
	'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
	'Cloudflare account ID must come from staging-deploy'
);
requireText("WRANGLER_VERSION: '4.120.0'", 'Wrangler must remain pinned to the reviewed version');
requireText(
	'WRANGLER_OUTPUT_FILE_PATH: /tmp/wrangler-pages-output.jsonl',
	'Wrangler structured output must be captured'
);
requireText(
	'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
	'artifact download action must remain pinned'
);
requireText(
	'name: fichario-static-${{ env.EXPECTED_SOURCE_COMMIT }}-staging',
	'artifact identity must bind the resolved source SHA to staging'
);
requireText(
	'run-id: ${{ env.ARTIFACT_RUN_ID }}',
	'artifact must come from the resolved triggering or explicitly selected build run'
);
for (const validator of [
	'checks/check-deployed-site.mjs',
	'checks/check-deployed-ui.mjs',
	'checks/check-deployment-artifact.mjs',
	'checks/deployment-contract.mjs',
	'checks/validate-pages-deploy-output.mjs'
]) {
	requireText(validator, `deployment artifact must require ${validator}`);
}
requireText('sha256sum -c SHA256SUMS', 'artifact checksums must be revalidated before deployment');
requireText('find "$artifact_root" -type l', 'artifact symlinks must be rejected');
requireText(
	'[[ "$(manifest_value source_commit)" == "$EXPECTED_SOURCE_COMMIT" ]]',
	'artifact manifest source SHA must equal the resolved deployment SHA'
);
requireText(
	'[[ "$(manifest_value target_environment)" == \'staging\' ]]',
	'artifact manifest must target staging'
);
requireText(
	'node "$artifact_root/checks/check-deployment-artifact.mjs" "$artifact_root"',
	'downloaded artifact must pass its bundled self-verifier after checksum validation'
);
requireText(
	'wrangler pages deploy "$ARTIFACT_ROOT/site"',
	'only the validated site directory may be deployed'
);
requireText('--project-name=fichario-virtual', 'deployment must remain scoped to fichario-virtual');
requireText('--branch=staging', 'deployment must remain a non-production Pages preview');
requireText(
	'--commit-hash="$EXPECTED_SOURCE_COMMIT"',
	'deployment metadata must preserve the validated SHA'
);
requireText(
	'node "$ARTIFACT_ROOT/checks/validate-pages-deploy-output.mjs"',
	'Wrangler output must be validated by artifact-pinned code'
);
requireText(
	'node "$ARTIFACT_ROOT/checks/check-deployed-site.mjs" "$DEPLOYMENT_URL"',
	'exact deployment URL must pass the artifact-pinned HTTP/CSP contract'
);
requireText(
	'node checks/check-deployed-ui.mjs "$DEPLOYMENT_URL"',
	'exact deployment URL must pass the artifact-pinned Chromium rendering smoke'
);
requireText(
	'npx playwright install --with-deps chromium',
	'deployment smoke must install and use real Chromium'
);
requireText(
	'name: deployed-ui-${{ env.EXPECTED_SOURCE_COMMIT }}',
	'rendered UI evidence must remain bound to the deployed SHA'
);

for (const forbidden of [
	'actions/checkout@',
	'pnpm install',
	'pnpm build',
	'pnpm verify',
	'wrangler pages project create',
	'production-deploy',
	'CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED',
	'--branch=main',
	'https://fichario-virtual.pages.dev',
	'options:\n          - staging\n          - production'
]) {
	forbidText(forbidden, `staging deployment workflow must not contain ${forbidden}`);
}

if (failures.length > 0) {
	console.error(`Cloudflare deployment workflow checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Cloudflare deployment workflow checks passed.');
}
