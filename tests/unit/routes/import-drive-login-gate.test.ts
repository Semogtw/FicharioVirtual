import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
const dialog = readFileSync('src/lib/components/DriveUploadGate.svelte', 'utf8');
const gate = readFileSync('src/lib/stores/drive-upload-gate.svelte.ts', 'utf8');
const imageUpload = readFileSync('src/lib/import/upload.ts', 'utf8');
const pdfUpload = readFileSync('src/lib/pdf/upload.ts', 'utf8');

describe('Drive login gate for imports', () => {
	it('mounts a modal that asks the user to connect instead of surfacing an upload error', () => {
		expect(shell).toContain("import DriveUploadGate from './DriveUploadGate.svelte';");
		expect(shell).toContain('<DriveUploadGate />');
		expect(dialog).toContain('Entre no Google Drive para continuar');
		expect(dialog).toContain('Conectar Google Drive');
		expect(dialog).toContain('sem precisar escolher o arquivo de novo');
		expect(dialog).toContain('role="alert"');
	});

	it('animates both dialog and backdrop without delaying the existing modal semantics', () => {
		expect(dialog).toContain('@starting-style');
		expect(dialog).toContain('display var(--motion-base) allow-discrete');
		expect(dialog).toContain('overlay var(--motion-base) allow-discrete');
		expect(dialog).toContain('.drive-upload-dialog[open]::backdrop');
		expect(dialog).toContain('dialog.showModal()');
		expect(dialog).toContain('dialog.close()');
	});

	it('passes each import AbortSignal through the Drive gate before remote upload', () => {
		expect(imageUpload).toMatch(
			/export async function uploadPreparedImage[\s\S]*await requireDriveForUpload\(input\.signal\);[\s\S]*uploadPreparedImageToDrive/
		);
		expect(pdfUpload).toMatch(
			/export async function uploadPdf[\s\S]*await requireDriveForUpload\(options\.signal\);[\s\S]*uploadPdfToDrive/
		);
	});

	it('keeps pending uploads waiting while OAuth runs and releases them after connection', () => {
		expect(gate).toContain("window.open(\n\t\t'about:blank'");
		expect(gate).toContain("result === 'authorized'");
		expect(gate).toContain('resolveWaiters();');
		expect(gate).toContain("new DOMException('', 'AbortError')");
	});

	it('detaches an individually cancelled import without cancelling other Drive waiters', () => {
		expect(gate).toContain("signal.addEventListener('abort', waiter.onAbort, { once: true })");
		expect(gate).toContain("signal.removeEventListener('abort', waiter.onAbort)");
		expect(gate).toContain("settleWaiter(waiter, 'reject')");
		expect(gate).toContain('if (waiters.size > 0) return;');
	});
});
