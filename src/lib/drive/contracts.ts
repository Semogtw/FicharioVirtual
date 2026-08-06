import { z } from 'zod';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import type { DriveChange, DriveChangePage, DriveFile, DriveFileList } from './types';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MD5 = /^[0-9a-f]{32}$/i;

function hasControlCharacters(value: string) {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

const driveId = z.string().regex(DRIVE_ID);
const pageToken = z.string().trim().min(1).max(4_096).nullable();
const driveFileSchema = z
	.object({
		id: driveId,
		name: z
			.string()
			.trim()
			.min(1)
			.max(512)
			.refine((value) => !hasControlCharacters(value)),
		mimeType: z.string().trim().min(1).max(256),
		parents: z.array(driveId).max(100),
		modifiedTime: z.string().refine(isIsoTimestamp),
		version: z.string().regex(/^\d{1,32}$/),
		md5Checksum: z.string().regex(MD5).nullable(),
		trashed: z.boolean()
	})
	.strict();

const removedChangeSchema = z
	.object({
		fileId: driveId,
		removed: z.literal(true)
	})
	.strict();
const presentChangeSchema = z
	.object({
		fileId: driveId,
		removed: z.literal(false),
		file: driveFileSchema
	})
	.strict()
	.refine((change) => change.fileId === change.file.id);
const driveChangeSchema = z.discriminatedUnion('removed', [
	removedChangeSchema,
	presentChangeSchema
]);

function freezeDriveFile(file: z.infer<typeof driveFileSchema>): DriveFile {
	return Object.freeze({ ...file, parents: Object.freeze([...file.parents]) });
}

function freezeDriveChange(change: z.infer<typeof driveChangeSchema>): DriveChange {
	if (change.removed) return Object.freeze({ fileId: change.fileId, removed: true });
	return Object.freeze({
		fileId: change.fileId,
		removed: false,
		file: freezeDriveFile(change.file)
	});
}

export function parseDriveFile(data: unknown): DriveFile {
	const result = driveFileSchema.safeParse(data);
	if (!result.success) throw new TypeError('Invalid Drive file response');
	return freezeDriveFile(result.data);
}

export function parseDriveFileList(data: unknown): DriveFileList {
	const result = z
		.object({
			files: z.array(driveFileSchema).max(10_000),
			nextPageToken: pageToken
		})
		.strict()
		.safeParse(data);
	if (!result.success) throw new TypeError('Invalid Drive file list response');

	const ids = new Set<string>();
	const files = result.data.files.map((file) => {
		if (ids.has(file.id)) throw new TypeError('Invalid Drive file list response');
		ids.add(file.id);
		return freezeDriveFile(file);
	});

	return Object.freeze({
		files: Object.freeze(files),
		nextPageToken: result.data.nextPageToken
	});
}

export function parseDriveChangePage(data: unknown): DriveChangePage {
	const result = z
		.object({
			changes: z.array(driveChangeSchema).max(10_000),
			nextPageToken: pageToken,
			newStartPageToken: pageToken
		})
		.strict()
		.refine(
			(page) =>
				(page.nextPageToken === null) !== (page.newStartPageToken === null),
			{ message: 'exactly one continuation token is required' }
		)
		.safeParse(data);
	if (!result.success) throw new TypeError('Invalid Drive change response');

	const ids = new Set<string>();
	const changes = result.data.changes.map((change) => {
		if (ids.has(change.fileId)) throw new TypeError('Invalid Drive change response');
		ids.add(change.fileId);
		return freezeDriveChange(change);
	});

	return Object.freeze({
		changes: Object.freeze(changes),
		nextPageToken: result.data.nextPageToken,
		newStartPageToken: result.data.newStartPageToken
	});
}
