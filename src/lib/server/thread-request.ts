import type { ModelSelection, PermissionMode, ReasoningEffort, ServiceTier } from '$lib/types';

export const MAX_IMAGE_COUNT = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export class RequestValidationError extends Error {
	constructor(
		message: string,
		public readonly status = 400
	) {
		super(message);
	}
}

export function parsePermissionMode(value: unknown): PermissionMode {
	return value === 'auto' || value === 'full' ? value : 'default';
}

export function parseReasoningEffort(value: unknown): ReasoningEffort | null {
	return value === 'none' ||
		value === 'minimal' ||
		value === 'low' ||
		value === 'medium' ||
		value === 'high' ||
		value === 'xhigh'
		? value
		: null;
}

export function parseServiceTier(value: unknown): ServiceTier | null {
	return value === 'fast' || value === 'flex' ? value : null;
}

export function parseModelSelection(value: unknown): ModelSelection | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const model = typeof record.model === 'string' ? record.model.trim() : '';
	const effort = parseReasoningEffort(record.effort);
	const serviceTier = parseServiceTier(record.serviceTier);
	const provider = typeof record.provider === 'string' ? record.provider.trim() : '';

	return {
		...(model ? { model } : {}),
		...(effort ? { effort } : {}),
		...(serviceTier ? { serviceTier } : {}),
		...(provider ? { provider } : {})
	};
}

function dataUriImageBytes(value: string): number {
	const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
	if (!match) {
		throw new RequestValidationError('Images must be data:image/* base64 URLs.');
	}

	const base64 = match[1];
	if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
		throw new RequestValidationError('Image data must be valid base64.');
	}

	return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

export function parseImages(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) {
		throw new RequestValidationError('Images must be an array.');
	}
	if (value.length > MAX_IMAGE_COUNT) {
		throw new RequestValidationError(`At most ${MAX_IMAGE_COUNT} images are allowed.`);
	}

	let totalBytes = 0;
	const images: string[] = [];
	for (const image of value) {
		if (typeof image !== 'string' || !image) {
			throw new RequestValidationError('Images must be non-empty strings.');
		}
		const bytes = dataUriImageBytes(image);
		if (bytes > MAX_IMAGE_BYTES) {
			throw new RequestValidationError('Each image must be 10 MB or smaller.');
		}
		totalBytes += bytes;
		if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
			throw new RequestValidationError('Images must be 20 MB or smaller in total.');
		}
		images.push(image);
	}

	return images.length > 0 ? images : undefined;
}

export function parseThreadRequestBody(body: {
	cwd?: unknown;
	prompt?: unknown;
	permissionMode?: unknown;
	modelSelection?: unknown;
	images?: unknown;
}): {
	cwd: string;
	prompt: string;
	permissionMode: PermissionMode;
	modelSelection?: ModelSelection;
	images?: string[];
} {
	const cwd = String(body.cwd ?? '').trim();
	const prompt = String(body.prompt ?? '').trim();
	const images = parseImages(body.images);

	if (!cwd) {
		throw new RequestValidationError('Workspace path is required.');
	}
	if (!prompt && (!images || images.length === 0)) {
		throw new RequestValidationError('Prompt or image is required.');
	}

	return {
		cwd,
		prompt,
		permissionMode: parsePermissionMode(body.permissionMode),
		modelSelection: parseModelSelection(body.modelSelection),
		images
	};
}
