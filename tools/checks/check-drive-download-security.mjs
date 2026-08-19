import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const failures = [];
const [download, picker] = await Promise.all([
	readFile(join(root, 'src/lib/drive/bounded-download.ts'), 'utf8'),
	readFile(join(root, 'src/lib/drive/picker-service.ts'), 'utf8')
]);

for (const required of [
	'response.body.getReader()',
	'total > maximumBytes',
	"await reader.cancel('download exceeds configured limit')",
	"cache: 'no-store'"
]) {
	if (!download.includes(required)) {
		failures.push(`src/lib/drive/bounded-download.ts: missing ${required}`);
	}
}
if (/\bresponse\.blob\s*\(/.test(download)) {
	failures.push(
		'src/lib/drive/bounded-download.ts: response.blob() is forbidden for bounded downloads'
	);
}
if (!picker.includes("import { downloadBoundedBrowserDriveFile } from './bounded-download';")) {
	failures.push('src/lib/drive/picker-service.ts: picker must use the bounded Drive downloader');
}
if (picker.includes("from './browser-files'")) {
	failures.push(
		'src/lib/drive/picker-service.ts: picker must not use the legacy whole-response downloader'
	);
}
const boundedDefaults = picker.match(/download:\s*downloadBoundedBrowserDriveFile/g) ?? [];
if (boundedDefaults.length < 2) {
	failures.push(
		'src/lib/drive/picker-service.ts: all default direct-download paths must be bounded'
	);
}

if (failures.length > 0) {
	console.error(`Drive download security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Drive download security checks passed.');
}
