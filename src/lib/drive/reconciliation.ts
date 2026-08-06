import type {
	DriveChange,
	DriveDocumentSnapshot,
	ReconciledDriveDocument
} from './types';

function freezeResult(
	document: DriveDocumentSnapshot,
	changes: Partial<ReconciledDriveDocument>
): ReconciledDriveDocument {
	return Object.freeze({
		...document,
		...changes,
		tags: Object.freeze([...document.tags]),
		conflict: changes.conflict ? Object.freeze({ ...changes.conflict }) : null
	});
}

export function reconcileDrivePresence(
	document: DriveDocumentSnapshot,
	change: DriveChange
): ReconciledDriveDocument {
	if (change.fileId !== document.driveFileId) {
		return freezeResult(document, {
			conflict: {
				kind: 'identity_mismatch',
				remoteFileId: change.fileId
			}
		});
	}

	if (change.removed) {
		return freezeResult(document, {
			physicalState: 'missing',
			conflict: null
		});
	}

	return freezeResult(document, {
		physicalState: change.file.trashed ? 'missing' : 'available',
		driveModifiedTime: change.file.modifiedTime,
		driveVersion: change.file.version,
		conflict: null
	});
}
