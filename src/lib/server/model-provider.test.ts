import { describe, expect, test } from 'bun:test';

import { isAllowedCustomProviderHost, normalizeOaiModel, resolveCustomProviderModelsUrl } from './model-provider';

describe('custom model provider URLs', () => {
	test('allows localhost and loopback providers', () => {
		expect(resolveCustomProviderModelsUrl('http://127.0.0.1:9090').modelsUrl).toBe('http://127.0.0.1:9090/models');
		expect(resolveCustomProviderModelsUrl('http://localhost:11434/v1/').modelsUrl).toBe('http://localhost:11434/v1/models');
		expect(resolveCustomProviderModelsUrl('http://[::1]:9090').provider).toBe('::1');
	});

	test('rejects non-loopback provider hosts and unsafe URL forms', () => {
		expect(() => resolveCustomProviderModelsUrl('http://192.168.1.10:9090')).toThrow('loopback');
		expect(() => resolveCustomProviderModelsUrl('http://10.0.0.5:9090')).toThrow('loopback');
		expect(() => resolveCustomProviderModelsUrl('file:///tmp/models')).toThrow('http or https');
		expect(() => resolveCustomProviderModelsUrl('http://user:pass@127.0.0.1:9090')).toThrow('credentials');
	});

	test('validates loopback IPv4 ranges precisely', () => {
		expect(isAllowedCustomProviderHost('127.0.0.1')).toBe(true);
		expect(isAllowedCustomProviderHost('127.255.255.255')).toBe(true);
		expect(isAllowedCustomProviderHost('127.0.0.256')).toBe(false);
		expect(isAllowedCustomProviderHost('128.0.0.1')).toBe(false);
	});
});

describe('OpenAI-compatible model normalization', () => {
	test('normalizes model entries and rejects entries without ids', () => {
		expect(normalizeOaiModel({ id: 'local-model', display_name: 'Local Model' }, 'localhost')).toMatchObject({
			id: 'local-model',
			model: 'local-model',
			displayName: 'Local Model',
			provider: 'localhost'
		});
		expect(normalizeOaiModel({ display_name: 'Missing id' }, 'localhost')).toBeNull();
	});
});
