import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._:/-]+$/;

export type DesktopOcrDeviceStatus = 'active' | 'revoked';

export type DesktopOcrDeviceCapabilities = Readonly<{
	protocolVersion: number | null;
	backend: 'ollama' | null;
	model: string | null;
	maxConcurrency: number | null;
}>;

export type DesktopOcrDevice = Readonly<{
	id: string;
	label: string;
	status: DesktopOcrDeviceStatus;
	capabilities: DesktopOcrDeviceCapabilities;
	lastSeenAt: string | null;
	revokedAt: string | null;
	createdAt: string;
	updatedAt: string;
}>;

export type DesktopOcrRevocation = Readonly<{
	deviceId: string;
	status: 'revoked';
	revokedAt: string;
	requeuedJobs: number;
}>;

export type DesktopOcrRename = Readonly<{
	deviceId: string;
	label: string;
	updatedAt: string;
}>;

export class DesktopOcrDevicesError extends Error {
	constructor(message = 'Não foi possível carregar os computadores de OCR.') {
		super(message);
		this.name = 'DesktopOcrDevicesError';
	}
}

type DevicesRpcClient = {
	rpc(
		name: 'list_ocr_worker_devices',
		args?: Record<string, never>
	): Promise<{ data: unknown; error: unknown }>;
	rpc(
		name: 'revoke_ocr_worker_device',
		args: { target_device_id: string }
	): Promise<{ data: unknown; error: unknown }>;
	rpc(
		name: 'rename_ocr_worker_device',
		args: { target_device_id: string; device_label: string }
	): Promise<{ data: unknown; error: unknown }>;
};

function timestamp(value: unknown, nullable = false): string | null {
	if (value === null && nullable) return null;
	if (typeof value !== 'string' || value.length < 20 || value.length > 64) return null;
	return Number.isFinite(Date.parse(value)) ? value : null;
}

function capabilities(value: unknown): DesktopOcrDeviceCapabilities {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return Object.freeze({
			protocolVersion: null,
			backend: null,
			model: null,
			maxConcurrency: null
		});
	}
	const record = value as Record<string, unknown>;
	return Object.freeze({
		protocolVersion:
			Number.isSafeInteger(record.protocolVersion) && Number(record.protocolVersion) >= 1
				? Number(record.protocolVersion)
				: null,
		backend: record.backend === 'ollama' ? 'ollama' : null,
		model:
			typeof record.model === 'string' &&
			record.model.length >= 1 &&
			record.model.length <= 128 &&
			MODEL.test(record.model)
				? record.model
				: null,
		maxConcurrency:
			Number.isSafeInteger(record.maxConcurrency) &&
			Number(record.maxConcurrency) >= 1 &&
			Number(record.maxConcurrency) <= 8
				? Number(record.maxConcurrency)
				: null
	});
}

function parseDevice(value: unknown): DesktopOcrDevice | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const createdAt = timestamp(record.created_at);
	const updatedAt = timestamp(record.updated_at);
	const lastSeenAt = timestamp(record.last_seen_at, true);
	const revokedAt = timestamp(record.revoked_at, true);
	if (
		typeof record.device_id !== 'string' ||
		!UUID.test(record.device_id) ||
		typeof record.label !== 'string' ||
		record.label !== record.label.trim() ||
		record.label.length < 1 ||
		record.label.length > 80 ||
		(record.status !== 'active' && record.status !== 'revoked') ||
		createdAt === null ||
		updatedAt === null ||
		(record.last_seen_at !== null && lastSeenAt === null) ||
		(record.revoked_at !== null && revokedAt === null) ||
		(record.status === 'active' && revokedAt !== null) ||
		(record.status === 'revoked' && revokedAt === null)
	) {
		return null;
	}
	return Object.freeze({
		id: record.device_id,
		label: record.label,
		status: record.status,
		capabilities: capabilities(record.capabilities),
		lastSeenAt,
		revokedAt,
		createdAt,
		updatedAt
	});
}

function parseDevices(value: unknown): readonly DesktopOcrDevice[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;
	const parsed: DesktopOcrDevice[] = [];
	for (const item of value) {
		const device = parseDevice(item);
		if (!device) return null;
		parsed.push(device);
	}
	return Object.freeze(parsed);
}

function parseRevocation(value: unknown, expectedDeviceId: string): DesktopOcrRevocation | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, Json | undefined>;
	const revokedAt = timestamp(record.revokedAt);
	if (
		record.deviceId !== expectedDeviceId ||
		record.status !== 'revoked' ||
		revokedAt === null ||
		!Number.isSafeInteger(record.requeuedJobs) ||
		Number(record.requeuedJobs) < 0
	) {
		return null;
	}
	return Object.freeze({
		deviceId: expectedDeviceId,
		status: 'revoked',
		revokedAt,
		requeuedJobs: Number(record.requeuedJobs)
	});
}

function parseRename(
	value: unknown,
	expectedDeviceId: string,
	expectedLabel: string
): DesktopOcrRename | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, Json | undefined>;
	const updatedAt = timestamp(record.updatedAt);
	if (
		record.deviceId !== expectedDeviceId ||
		record.label !== expectedLabel ||
		updatedAt === null
	) {
		return null;
	}
	return Object.freeze({
		deviceId: expectedDeviceId,
		label: expectedLabel,
		updatedAt
	});
}

function gateway(client?: SupabaseClient<Database>): DevicesRpcClient {
	return (client ?? getSupabaseClient()) as unknown as DevicesRpcClient;
}

export async function listDesktopOcrDevices(
	client?: SupabaseClient<Database>
): Promise<readonly DesktopOcrDevice[]> {
	let result: { data: unknown; error: unknown };
	try {
		result = await gateway(client).rpc('list_ocr_worker_devices');
	} catch {
		throw new DesktopOcrDevicesError();
	}
	if (result.error) throw new DesktopOcrDevicesError();
	const devices = parseDevices(result.data);
	if (!devices)
		throw new DesktopOcrDevicesError('A lista de computadores retornou um formato inválido.');
	return devices;
}

export async function revokeDesktopOcrDevice(
	deviceId: string,
	client?: SupabaseClient<Database>
): Promise<DesktopOcrRevocation> {
	if (!UUID.test(deviceId)) throw new TypeError('Invalid desktop OCR device id');
	let result: { data: unknown; error: unknown };
	try {
		result = await gateway(client).rpc('revoke_ocr_worker_device', {
			target_device_id: deviceId
		});
	} catch {
		throw new DesktopOcrDevicesError('Não foi possível revogar este computador de OCR.');
	}
	if (result.error) {
		throw new DesktopOcrDevicesError('Não foi possível revogar este computador de OCR.');
	}
	const revocation = parseRevocation(result.data, deviceId);
	if (!revocation) {
		throw new DesktopOcrDevicesError('A confirmação de revogação retornou um formato inválido.');
	}
	return revocation;
}

export async function renameDesktopOcrDevice(
	deviceId: string,
	label: string,
	client?: SupabaseClient<Database>
): Promise<DesktopOcrRename> {
	if (!UUID.test(deviceId)) throw new TypeError('Invalid desktop OCR device id');
	const normalizedLabel = label.trim();
	if (normalizedLabel.length < 1 || normalizedLabel.length > 80) {
		throw new TypeError('Invalid desktop OCR device label');
	}

	let result: { data: unknown; error: unknown };
	try {
		result = await gateway(client).rpc('rename_ocr_worker_device', {
			target_device_id: deviceId,
			device_label: normalizedLabel
		});
	} catch {
		throw new DesktopOcrDevicesError('Não foi possível renomear este computador de OCR.');
	}
	if (result.error) {
		throw new DesktopOcrDevicesError('Não foi possível renomear este computador de OCR.');
	}
	const rename = parseRename(result.data, deviceId, normalizedLabel);
	if (!rename) {
		throw new DesktopOcrDevicesError('A confirmação de renomeação retornou um formato inválido.');
	}
	return rename;
}
