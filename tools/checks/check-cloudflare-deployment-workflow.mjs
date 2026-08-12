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
	'deployment must continue using the existing protected Cloudflare credentials'
);
requireText(
	'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
	'Cloudflare API token must come from the protected deployment environment'
);
requireText(
	'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
	'Cloudflare account ID must come from the protected deployment environment'
);
requireText("WRANGLER_VERSION: '4.120.0'", 'Wrangler must remain pinned to the reviewed version');
requireText(
	'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
	'artifact download action must remain pinned'
);
requireText(
	'name: fichario-static-${{ env.EXPECTED_SOURCE_COMMIT }}-staging',
	'artifact identity must remain bound to the resolved source SHA'
);
requireText('run-id: ${{ env.ARTIFACT_RUN_ID }}', 'artifact must come from the resolved build run');

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
	'artifact must retain its reviewed staging runtime configuration'
);
requireText(
	'node "$artifact_root/checks/check-deployment-artifact.mjs" "$artifact_root"',
	'downloaded artifact must pass its bundled self-verifier'
);

requireText('id: deploy_staging', 'workflow must keep an explicit staging preview deployment');
requireText('TARGET_ENVIRONMENT: staging', 'staging validator target must be explicit');
requireText(
	'WRANGLER_OUTPUT_FILE_PATH: /tmp/wrangler-pages-staging-output.jsonl',
	'staging Wrangler structured output must be isolated'
);
requireText('--branch=staging', 'staging must remain a Pages preview branch');

requireText('id: deploy_production', 'workflow must promote the validated artifact to production');
requireText('TARGET_ENVIRONMENT: production', 'production validator target must be explicit');
requireText(
	'WRANGLER_OUTPUT_FILE_PATH: /tmp/wrangler-pages-production-output.jsonl',
	'production Wrangler structured output must be isolated'
);
requireText(
	'--commit-message="Deploy validated Fichário production artifact ${EXPECTED_SOURCE_COMMIT}"',
	'production deployment must retain source identity in metadata'
);
requireText(
	'https://fichario-virtual.pages.dev',
	'production verification must target the stable root Pages domain'
);

requireText(
	'wrangler pages deploy "$ARTIFACT_ROOT/site"',
	'only the validated site directory may be deployed'
);
requireText(
	'--project-name=fichario-virtual',
	'deployments must remain scoped to fichario-virtual'
);
requireText(
	'--commit-hash="$EXPECTED_SOURCE_COMMIT"',
	'deployment metadata must preserve the validated SHA'
);
requireText(
	'node "$ARTIFACT_ROOT/checks/validate-pages-deploy-output.mjs"',
	'Wrangler output must be validated by artifact-pinned code'
);
requireText(
	'node "$ARTIFACT_ROOT/checks/check-deployed-site.mjs" "$PRODUCTION_ALIAS"',
	'production root must pass the artifact-pinned HTTP/CSP contract'
);
requireText(
	'DEPLOYMENT_UI_EVIDENCE_DIR="$GITHUB_WORKSPACE/deployment-ui-evidence/production-alias"',
	'production root must pass the real Chromium rendering smoke'
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
	'CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED',
	'--branch=main',
	'options:\n          - staging\n          - production'
]) {
	forbidText(forbidden, `deployment workflow must not contain ${forbidden}`);
}

if (failures.length > 0) {
	console.error(`Cloudflare deployment workflow checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Cloudflare staging + production deployment workflow checks passed.');
}
