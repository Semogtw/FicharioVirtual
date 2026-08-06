export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file' as const;
export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder' as const;

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

function escapeDriveLiteral(value: string): string {
	const normalized = value.trim();
	if (
		normalized.length === 0 ||
		normalized.length > 512 ||
		[...normalized].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError('Invalid Drive query value');
	}
	return normalized.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function rootFolderQuery(name: string): string {
	return `name = '${escapeDriveLiteral(name)}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;
}

export function childFolderQuery(parentId: string, name: string): string {
	if (!DRIVE_ID.test(parentId)) throw new TypeError('Invalid Drive parent identifier');
	return `name = '${escapeDriveLiteral(name)}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and '${parentId}' in parents and trashed = false`;
}
