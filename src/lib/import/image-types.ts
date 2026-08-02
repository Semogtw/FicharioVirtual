export type ImagePreparationMode = 'standard' | 'high-definition';
export type PreparedImageFormat = 'image/webp' | 'image/jpeg';

export type ImageWorkerRequest = {
	type: 'prepare';
	id: string;
	file: File;
	maxDimension: 2560 | 3200;
	thumbnailDimension: 480;
	quality: number;
};

export type ImageWorkerSuccess = {
	type: 'success';
	id: string;
	image: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
	format: PreparedImageFormat;
};

export type ImageWorkerFailure = {
	type: 'failure';
	id: string;
	code: 'decode_failed' | 'encode_failed' | 'unsupported_image' | 'worker_failed';
};

export type ImageWorkerResponse = ImageWorkerSuccess | ImageWorkerFailure;

export type PreparedImage = {
	image: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
	format: PreparedImageFormat;
	originalName: string;
	originalBytes: number;
	preparedBytes: number;
};

export type ImagePreparationOptions = {
	signal?: AbortSignal;
};
