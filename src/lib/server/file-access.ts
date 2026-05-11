import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif'
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export class FileAccessError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message);
	}
}

function stripFileProtocol(input: string): string {
	return input
		.replace(/^file:\/\/\//i, '')
		.replace(/^file:\/\//i, '')
		.replace(/^file:/i, '')
		.replace(/^\/([a-zA-Z]:)/, '$1');
}

export function normalizeLocalPath(input: string): string {
	return stripFileProtocol(input.trim());
}

function canonicalKey(input: string): string {
	const normalized = path.resolve(normalizeLocalPath(input));
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInside(child: string, root: string): boolean {
	const childKey = canonicalKey(child);
	const rootKey = canonicalKey(root);
	return childKey === rootKey || childKey.startsWith(rootKey + path.sep);
}

function contentDisposition(filename: string, ext: string): string {
	if (ext === '.svg') {
		return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
	}
	return ext in MIME_TYPES
		? 'inline'
		: `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class WorkspaceAccessRegistry {
	private readonly roots = new Set<string>();

	constructor(defaultRoots: string[] = []) {
		for (const root of defaultRoots) {
			this.allowRoot(root);
		}
	}

	allowRoot(root: string): void {
		const normalized = normalizeLocalPath(root);
		if (!normalized) return;
		this.roots.add(canonicalKey(normalized));
	}

	isAllowedRoot(root: string): boolean {
		const normalized = normalizeLocalPath(root);
		if (!normalized) return false;
		const key = canonicalKey(normalized);
		for (const allowed of this.roots) {
			if (key === allowed || key.startsWith(allowed + path.sep)) return true;
		}
		return false;
	}
}

export type ServedFile = {
	body: ArrayBuffer;
	headers: HeadersInit;
};

export async function serveWorkspaceFile(
	params: {
		filePath: string | null | undefined;
		cwd: string | null | undefined;
	},
	registry: WorkspaceAccessRegistry
): Promise<ServedFile> {
	const requestedPath = normalizeLocalPath(params.filePath ?? '');
	const requestedCwd = normalizeLocalPath(params.cwd ?? '');

	if (!requestedPath) {
		throw new FileAccessError('Missing path parameter', 400);
	}
	if (!requestedCwd || !registry.isAllowedRoot(requestedCwd)) {
		throw new FileAccessError('Access denied', 403);
	}

	const root = path.resolve(requestedCwd);
	const resolvedPath = path.isAbsolute(requestedPath)
		? path.resolve(requestedPath)
		: path.resolve(root, requestedPath);

	if (!isPathInside(resolvedPath, root)) {
		throw new FileAccessError('Access denied', 403);
	}

	let realRoot: string;
	let realFile: string;
	try {
		[realRoot, realFile] = await Promise.all([realpath(root), realpath(resolvedPath)]);
	} catch {
		throw new FileAccessError('File not found', 404);
	}

	if (!isPathInside(realFile, realRoot)) {
		throw new FileAccessError('Access denied', 403);
	}

	const info = await stat(realFile);
	if (!info.isFile()) {
		throw new FileAccessError('Not a file', 400);
	}
	if (info.size > MAX_FILE_SIZE) {
		throw new FileAccessError('File too large', 400);
	}

	const ext = path.extname(realFile).toLowerCase();
	const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
	const filename = path.basename(realFile);
	const body = await readFile(realFile);

	return {
		body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': contentDisposition(filename, ext),
			'Cache-Control': 'private, max-age=3600',
			'X-Content-Type-Options': 'nosniff'
		}
	};
}
