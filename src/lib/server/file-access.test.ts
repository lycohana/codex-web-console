import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
	FileAccessError,
	serveWorkspaceFile,
	WorkspaceAccessRegistry
} from './file-access';

async function withTempWorkspace<T>(fn: (paths: { root: string; outside: string }) => Promise<T>): Promise<T> {
	const base = path.join(tmpdir(), `cwc-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const root = path.join(base, 'workspace');
	const outside = path.join(base, 'outside');
	await mkdir(root, { recursive: true });
	await mkdir(outside, { recursive: true });
	try {
		return await fn({ root, outside });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}

describe('workspace file access', () => {
	test('serves files from an allowed workspace root', async () => {
		await withTempWorkspace(async ({ root }) => {
			await writeFile(path.join(root, 'image.png'), 'png-bytes');
			const registry = new WorkspaceAccessRegistry([]);
			registry.allowRoot(root);

			const file = await serveWorkspaceFile({ cwd: root, filePath: 'image.png' }, registry);
			const headers = new Headers(file.headers);

			expect(Buffer.from(file.body).toString()).toBe('png-bytes');
			expect(headers.get('Content-Type')).toBe('image/png');
			expect(headers.get('Content-Disposition')).toBe('inline');
		});
	});

	test('rejects forged workspace roots', async () => {
		await withTempWorkspace(async ({ root, outside }) => {
			await writeFile(path.join(outside, 'secret.txt'), 'secret');
			const registry = new WorkspaceAccessRegistry([]);
			registry.allowRoot(root);

			try {
				await serveWorkspaceFile({ cwd: outside, filePath: 'secret.txt' }, registry);
				throw new Error('Expected serveWorkspaceFile to fail.');
			} catch (err) {
				expect((err as FileAccessError).status).toBe(403);
			}
		});
	});

	test('rejects path traversal outside the workspace', async () => {
		await withTempWorkspace(async ({ root, outside }) => {
			await writeFile(path.join(outside, 'secret.txt'), 'secret');
			const registry = new WorkspaceAccessRegistry([]);
			registry.allowRoot(root);

			try {
				await serveWorkspaceFile({ cwd: root, filePath: '../outside/secret.txt' }, registry);
				throw new Error('Expected serveWorkspaceFile to fail.');
			} catch (err) {
				expect((err as FileAccessError).status).toBe(403);
			}
		});
	});

	test('rejects symlinks that resolve outside the workspace', async () => {
		await withTempWorkspace(async ({ root, outside }) => {
			await writeFile(path.join(outside, 'secret.txt'), 'secret');
			const registry = new WorkspaceAccessRegistry([]);
			registry.allowRoot(root);

			try {
				await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
			} catch {
				return;
			}

			try {
				await serveWorkspaceFile({ cwd: root, filePath: 'link.txt' }, registry);
				throw new Error('Expected serveWorkspaceFile to fail.');
			} catch (err) {
				expect((err as FileAccessError).status).toBe(403);
			}
		});
	});

	test('serves SVG as attachment with nosniff', async () => {
		await withTempWorkspace(async ({ root }) => {
			await writeFile(path.join(root, 'unsafe.svg'), '<svg></svg>');
			const registry = new WorkspaceAccessRegistry([]);
			registry.allowRoot(root);

			const file = await serveWorkspaceFile({ cwd: root, filePath: 'unsafe.svg' }, registry);
			const headers = new Headers(file.headers);

			expect(headers.get('Content-Disposition')?.includes('attachment')).toBe(true);
			expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
		});
	});

	test('reports missing path as a bad request', async () => {
		const registry = new WorkspaceAccessRegistry([]);
		try {
			await serveWorkspaceFile({ cwd: tmpdir(), filePath: '' }, registry);
			throw new Error('Expected serveWorkspaceFile to fail.');
		} catch (err) {
			expect(err instanceof FileAccessError).toBe(true);
			expect((err as FileAccessError).status).toBe(400);
		}
	});
});
