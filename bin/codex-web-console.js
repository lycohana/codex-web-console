#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';

function loadTokenFromConfig() {
	if (process.env.CODEX_WEB_CONSOLE_TOKEN) return;
	try {
		const configPath = join(homedir(), '.codex-web-console', 'config.json');
		if (!existsSync(configPath)) return;
		const raw = readFileSync(configPath, 'utf-8');
		const data = JSON.parse(raw);
		if (typeof data.token === 'string' && data.token.trim()) {
			process.env.CODEX_WEB_CONSOLE_TOKEN = data.token.trim();
		}
	} catch {
		// ignore
	}
}

loadTokenFromConfig();

const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(__filename), '..');
const buildEntry = resolve(projectRoot, 'build', 'index.js');

function parseArgs(argv) {
	const options = {
		host: process.env.HOST || '127.0.0.1',
		port: process.env.PORT ? Number(process.env.PORT) : null,
		portExplicit: Boolean(process.env.PORT),
		open: true
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--no-open') {
			options.open = false;
		} else if (arg === '--host') {
			options.host = argv[++index] || options.host;
		} else if (arg.startsWith('--host=')) {
			options.host = arg.slice('--host='.length) || options.host;
		} else if (arg === '--port') {
			options.port = Number(argv[++index]);
			options.portExplicit = true;
		} else if (arg.startsWith('--port=')) {
			options.port = Number(arg.slice('--port='.length));
			options.portExplicit = true;
		} else if (arg === '--help' || arg === '-h') {
			console.log(`Usage: codex-web-console [--host 127.0.0.1] [--port 3000] [--no-open]`);
			process.exit(0);
		}
	}

	if (options.port !== null && !Number.isFinite(options.port)) {
		console.error('Invalid --port value.');
		process.exit(1);
	}

	return options;
}

function canListen(port, host) {
	return new Promise((resolveCanListen) => {
		const server = createServer();
		server.once('error', () => resolveCanListen(false));
		server.listen(port, host, () => {
			server.close(() => resolveCanListen(true));
		});
	});
}

async function resolvePort(options, fallbackPort) {
	const port = options.port ?? fallbackPort;
	if (options.portExplicit) {
		if (!(await canListen(port, options.host))) {
			console.error(`Port ${port} is already in use on ${options.host}.`);
			process.exit(1);
		}
		return port;
	}

	return findFreePort(port, options.host);
}

function findFreePort(start = 5173, host = '127.0.0.1') {
	return new Promise((resolvePort) => {
		const server = createServer();
		server.listen(start, host, () => {
			const port = server.address().port;
			server.close(() => resolvePort(port));
		});
		server.on('error', () => resolvePort(findFreePort(start + 1, host)));
	});
}

function openBrowser(url) {
	const command =
		process.platform === 'win32'
			? 'start'
			: process.platform === 'darwin'
				? 'open'
				: 'xdg-open';
	const args = process.platform === 'win32' ? ['', url] : [url];
	const opener = spawn(command, args, {
		stdio: 'ignore',
		shell: true,
		detached: true
	});
	opener.unref();
}

function spawnServer(command, args, env = {}) {
	const proc = spawn(command, args, {
		cwd: projectRoot,
		stdio: 'inherit',
		env: { ...process.env, ...env },
		shell: process.platform === 'win32'
	});

	proc.on('error', (error) => {
		console.error(error.message);
		process.exit(1);
	});
	proc.on('exit', (code) => process.exit(code ?? 0));
	process.on('SIGINT', () => proc.kill());
	process.on('SIGTERM', () => proc.kill());
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	if (existsSync(buildEntry)) {
		const port = String(await resolvePort(options, 3000));
		const host = options.host;
		const url = `http://${host}:${port}`;
		console.log(`Starting codex-web-console at ${url}`);
		if (options.open) openBrowser(url);
		spawnServer('bun', [buildEntry], {
			HOST: host,
			PORT: port,
			ORIGIN: process.env.ORIGIN || url
		});
		return;
	}

	const port = String(await resolvePort(options, 5173));
	const args = ['vite', 'dev', '--host', options.host, '--port', port];
	if (options.open) args.push('--open');
	spawnServer('npx', args);
}

main();
