import type { ModelOption, ReasoningEffort } from '$lib/types';

const LOOPBACK_V4_PREFIX = /^127(?:\.\d{1,3}){3}$/;
const LOCALHOST_NAMES = new Set(['localhost']);
const LOOPBACK_V6_NAMES = new Set(['::1', '[::1]', '0:0:0:0:0:0:0:1', '[0:0:0:0:0:0:0:1]']);

export function isAllowedCustomProviderHost(hostname: string): boolean {
	const normalized = hostname.trim().toLowerCase();
	if (LOCALHOST_NAMES.has(normalized) || LOOPBACK_V6_NAMES.has(normalized)) return true;

	if (!LOOPBACK_V4_PREFIX.test(normalized)) return false;
	return normalized
		.split('.')
		.every((part) => Number.isInteger(Number(part)) && Number(part) >= 0 && Number(part) <= 255);
}

export function resolveCustomProviderModelsUrl(rawUrl: string): {
	modelsUrl: string;
	provider: string;
} {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error('Invalid URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Provider URL must use http or https.');
	}

	if (parsed.username || parsed.password) {
		throw new Error('Provider URL must not include credentials.');
	}

	if (!isAllowedCustomProviderHost(parsed.hostname)) {
		throw new Error('Custom providers are limited to localhost or loopback addresses.');
	}

	parsed.hash = '';
	parsed.search = '';
	parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/models`;

	return {
		modelsUrl: parsed.toString(),
		provider: parsed.hostname.replace(/^\[(.*)\]$/, '$1')
	};
}

/** Normalize an OpenAI-compatible /models response entry into a ModelOption. */
export function normalizeOaiModel(raw: Record<string, unknown>, provider: string): ModelOption | null {
	const id = typeof raw.id === 'string' ? raw.id : null;
	if (!id) return null;
	return {
		id,
		model: id,
		displayName: typeof raw.display_name === 'string' ? raw.display_name : id,
		description: typeof raw.description === 'string' ? raw.description : `${provider} model`,
		hidden: false,
		supportedReasoningEfforts: [] as ReasoningEffort[],
		defaultReasoningEffort: 'medium' as ReasoningEffort,
		additionalSpeedTiers: [],
		isDefault: false,
		provider
	};
}
