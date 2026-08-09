import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const migrationPath = join(
	root,
	'supabase/migrations/202608081011_harden_drive_pdf_descriptor_security.sql'
);
const source = await readFile(migrationPath, 'utf8');
const failures = [];

const functions = [
	['stage_drive_pdf_reference_page_batch', 'uuid, jsonb', 'service_role'],
	['finalize_staged_drive_pdf_reference_import', 'uuid, integer, integer', 'service_role'],
	[
		'begin_drive_pdf_reference_descriptor_attempt',
		'uuid, uuid, integer',
		'authenticated, service_role'
	],
	['renew_drive_pdf_reference_descriptor_attempt', 'uuid, uuid', 'authenticated, service_role'],
	[
		'stage_drive_pdf_reference_descriptor_batch',
		'uuid, uuid, jsonb',
		'authenticated, service_role'
	],
	[
		'finalize_drive_pdf_reference_descriptor_attempt',
		'uuid, uuid, integer',
		'authenticated, service_role'
	],
	['abandon_drive_pdf_reference_descriptor_attempt', 'uuid, uuid', 'authenticated, service_role']
];

function statement(pattern, description) {
	if (!pattern.test(source)) failures.push(description);
}

for (const [name, signature, grants] of functions) {
	const escapedName = name.replaceAll('_', '\\_');
	const escapedSignature = signature.replaceAll(',', ',\\s*');
	statement(
		new RegExp(
			`alter\\s+function\\s+public\\.${escapedName}\\(\\s*${escapedSignature}\\s*\\)[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
			'i'
		),
		`${name} must retain an empty search_path`
	);
	statement(
		new RegExp(
			`grant\\s+execute\\s+on\\s+function\\s+public\\.${escapedName}\\(\\s*${escapedSignature}\\s*\\)[\\s\\S]*?to\\s+${grants.replaceAll(', ', '\\s*,\\s*')}`,
			'i'
		),
		`${name} must grant only its expected caller roles`
	);
}

for (const [name, signature] of functions) {
	const escapedName = name.replaceAll('_', '\\_');
	const escapedSignature = signature.replaceAll(',', ',\\s*');
	const allowedRoles =
		name.includes('stage_drive_pdf_reference_page_batch') ||
		name.includes('finalize_staged_drive_pdf_reference_import')
			? 'public,\\s*anon,\\s*authenticated'
			: 'public,\\s*anon';
	statement(
		new RegExp(
			`revoke\\s+execute\\s+on\\s+function\\s+public\\.${escapedName}\\(\\s*${escapedSignature}\\s*\\)[\\s\\S]*?from\\s+${allowedRoles}`,
			'i'
		),
		`${name} must revoke inherited execute privileges`
	);
}

if (failures.length > 0) {
	console.error(`Drive PDF descriptor security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Drive PDF descriptor security checks passed.');
}
