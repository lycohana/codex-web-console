import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { normalizeContextUsage, readContextUsageFromRollout } from './codex';

describe('context usage normalization', () => {
	test('normalizes direct thread usage fields', () => {
		const usage = normalizeContextUsage({
			usedTokens: 209_000,
			contextWindow: 258_000
		});

		expect(usage).toMatchObject({
			usedTokens: 209_000,
			totalTokens: 258_000
		});
		expect(Math.round(usage?.percentage ?? 0)).toBe(81);
	});

	test('normalizes nested snake case usage fields', () => {
		expect(
			normalizeContextUsage({
				context_usage: {
					input_tokens: '1200',
					model_context_window: '10000'
				}
			})
		).toMatchObject({
			usedTokens: 1200,
			totalTokens: 10000,
			percentage: 12
		});
	});

	test('normalizes raw Codex token count events', () => {
		expect(
			normalizeContextUsage({
				type: 'token_count',
				info: {
					last_token_usage: {
						input_tokens: 208_000,
						total_tokens: 209_000
					},
					model_context_window: 258_000
				}
			})
		).toMatchObject({
			usedTokens: 209_000,
			totalTokens: 258_000,
			percentage: 81.0077519379845
		});
	});

	test('reads latest context usage from rollout jsonl', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'codex-context-'));
		const file = path.join(dir, 'rollout.jsonl');
		await writeFile(
			file,
			[
				JSON.stringify({
					type: 'event_msg',
					payload: { type: 'task_started', model_context_window: 258_000 }
				}),
				JSON.stringify({
					type: 'event_msg',
					payload: {
						type: 'token_count',
						info: {
							last_token_usage: { total_tokens: 120_000 },
							model_context_window: 258_000
						}
					}
				})
			].join('\n'),
			'utf-8'
		);

		try {
			expect(await readContextUsageFromRollout(file)).toMatchObject({
				usedTokens: 120_000,
				totalTokens: 258_000
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('keeps partial real data instead of inventing usage', () => {
		expect(normalizeContextUsage({ model_context_window: 1_000_000 })).toMatchObject({
			usedTokens: null,
			totalTokens: 1_000_000,
			percentage: null,
			source: 'thread'
		});
		expect(normalizeContextUsage({ id: 'thread-1', preview: 'hello' })).toBeNull();
	});
});
