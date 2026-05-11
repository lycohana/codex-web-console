import { describe, expect, test } from 'bun:test';

import {
	parseImages,
	parseThreadRequestBody,
	RequestValidationError
} from './thread-request';

const tinyPng = 'data:image/png;base64,aGVsbG8=';

describe('thread request parsing', () => {
	test('allows text prompts and image-only prompts', () => {
		expect(parseThreadRequestBody({ cwd: '/tmp/project', prompt: 'hello' })).toMatchObject({
			cwd: '/tmp/project',
			prompt: 'hello'
		});
		expect(parseThreadRequestBody({ cwd: '/tmp/project', prompt: '', images: [tinyPng] }).images?.[0]).toBe(tinyPng);
	});

	test('rejects requests without a workspace or content', () => {
		try {
			parseThreadRequestBody({ cwd: '', prompt: 'hello' });
			throw new Error('Expected validation to fail.');
		} catch (err) {
			expect(err instanceof RequestValidationError).toBe(true);
			expect((err as RequestValidationError).message).toBe('Workspace path is required.');
		}

		try {
			parseThreadRequestBody({ cwd: '/tmp/project', prompt: '' });
			throw new Error('Expected validation to fail.');
		} catch (err) {
			expect((err as RequestValidationError).message).toBe('Prompt or image is required.');
		}
	});

	test('rejects unsupported image inputs', () => {
		expect(() => parseImages(['data:text/html;base64,PGgxPkJvb208L2gxPg=='])).toThrow('data:image');
		expect(() => parseImages(['data:image/png;base64,not valid'])).toThrow('base64');
		expect(() => parseImages(new Array(6).fill(tinyPng))).toThrow('At most');
	});
});
