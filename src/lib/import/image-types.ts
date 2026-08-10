export type ImagePreparationMode = 'standard' | 'high-definition';
export type PreparedImageFormat = 'image/webp' | 'image/jpeg';
export type ImagePreprocessingProfile = 'ocr_clean_v1';

export type ImagePreprocessingMetadata = Readonly<{
	profile: ImagePreprocessingProfile;
	version: 1;
	autoCropApplied: boolean;
	retainedAreaPermille: number;
	deskewMilliDegrees: number;
	illuminationNormalized: boolean;
	contrastEnhanced: boolean;
	fallbackToStandard: boolean;
	sourceWidth: number;
	sourceHeight: number;
	preparedWidth: number;
	preparedHeight: number;
}>;

export type ImageWorkerRequest = {
	type: 'prepare';
	id: string;
	file: File;
	maxDimension: 2560 | 3200;
	thumbnailDimension: 480;
	quality: number;
	preprocessingProfile: ImagePreprocessingProfile;
};

export type ImageWorkerSuccess = {
	type: 'success';
	id: string;
	image: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
	format: PreparedImageFormat;
	preprocessing: ImagePreprocessingMetadata;
};

export type ImageWorkerFailure = {
	type: 'failure';
	id: string;
	code: 'decode_failed' | 'encode_failed' | 'unsupported_image' | 'worker_failed';
};

export type ImageWorkerResponse = ImageWorkerSuccess | ImageWorkerFailure;

export type PreparedImage = {
	original: File;
	image: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
	format: PreparedImageFormat;
	preprocessing: ImagePreprocessingMetadata;
	originalName: string;
	originalBytes: number;
	preparedBytes: number;
};

export type ImagePreparationOptions = {
	signal?: AbortSignal;
};
