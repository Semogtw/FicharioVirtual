export type DrivePhysicalState = 'available' | 'missing' | 'reconnecting';

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	parents: readonly string[];
	modifiedTime: string;
	version: string;
	md5Checksum: string | null;
	trashed: boolean;
}

export interface DriveFileList {
	files: readonly DriveFile[];
	nextPageToken: string | null;
}

export type DriveChange =
	| {
			fileId: string;
			removed: true;
	  }
	| {
			fileId: string;
			removed: false;
			file: DriveFile;
	  };

export interface DriveChangePage {
	changes: readonly DriveChange[];
	nextPageToken: string | null;
	newStartPageToken: string | null;
}

export interface DriveDocumentSnapshot {
	id: string;
	driveFileId: string;
	physicalState: DrivePhysicalState;
	title: string;
	notebookId: string | null;
	tags: readonly string[];
	ocrText: string | null;
	correctedText: string | null;
	driveModifiedTime: string | null;
	driveVersion: string | null;
}

export interface DriveIdentityConflict {
	kind: 'identity_mismatch';
	remoteFileId: string;
}

export interface ReconciledDriveDocument extends DriveDocumentSnapshot {
	conflict: DriveIdentityConflict | null;
}
