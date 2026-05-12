<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';

	import LoginView from '$lib/components/LoginView.svelte';
	import ThreadList from '$lib/components/ThreadList.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import WorkspaceBrowser from '$lib/components/WorkspaceBrowser.svelte';
	import type {
		ApprovalRequest,
		ContextUsage,
		ConsoleEvent,
		DirectoryListing,
		ModelOption,
		ModelSelection,
		PermissionMode,
		ReasoningEffort,
		ServiceTier,
		ThreadDetail,
		ThreadSummary,
		TimelineEntry
	} from '$lib/types';

	let {
		data,
		form
	}: {
		data: {
			authenticated: boolean;
			tokenConfigured: boolean;
			setupMode: boolean;
			fallbackTokenActive: boolean;
			threads: ThreadSummary[];
			selectedThread: ThreadDetail | null;
			homePath: string;
			codexError: string | null;
		};
		form?: {
			loginError?: string;
			setupError?: string;
		};
	} = $props();

	type SequencedConsoleEvent = {
		id: number;
		event: ConsoleEvent;
	};

	type ThreadListResponse = {
		threads: ThreadSummary[];
		signature: string;
	};

	type ThreadListProbeResponse = {
		signature: string;
		count: number;
		latestUpdatedAt: number | null;
	};

	const THREAD_LIST_PROBE_INTERVAL_MS = 5000;

	const authenticated = $derived(Boolean(data.authenticated));

	// ── State ──
	let threads = $state<ThreadSummary[]>([]);
	let selectedThreadId = $state<string | null>(null);
	let selectedThread = $state<ThreadDetail | null>(null);
	let liveEntries = $state<Record<string, TimelineEntry>>({});
	let liveEntryBuffers = $state<Record<string, Record<string, TimelineEntry>>>({});
	let approvals = $state<ApprovalRequest[]>([]);
	let browserOpen = $state(false);
	let listing = $state<DirectoryListing | null>(null);
	let workspacePath = $state('');
	let newPrompt = $state('');
	let replyPrompt = $state('');
	let pendingImages = $state<string[]>([]);
	let replyImages = $state<string[]>([]);
	let newImageInput = $state<HTMLInputElement | null>(null);
	let replyImageInput = $state<HTMLInputElement | null>(null);
	let providerFilter = $state('all');
	let sidebarCollapsed = $state(false);
	let sidebarCollapseRestored = $state(false);
	let lastThreadRestored = $state(false);
	let draftingThread = $state(false);
	let errorMessage = $state<string | null>(null);
	let bootErrorMessage = $state<string | null>(null);
	let loadingThread = $state(false);
	let submitting = $state(false);
	let interrupting = $state(false);
	let source: EventSource | null = null;
	let eventPollController: AbortController | null = null;
	let lastEventId = 0;
	let threadListSignature = $state('');
	let forceEventPolling = $state(false);
	let liveEntryFlushFrame: number | null = null;
	let followLiveOutputFrame: number | null = null;
	let mainScroller = $state<HTMLElement | null>(null);
	let mobileComposerElement = $state<HTMLElement | null>(null);
	let codexSidebarPanel = $state<HTMLElement | null>(null);
	let autoScrolledThreadId = $state<string | null>(null);
	let activeTurnIndex = $state(0);
	let turnNavigationLockUntil = $state(0);
	let scrollRestoreLockUntil = $state(0);
	let followLiveOutput = $state(true);
	let showScrollToBottom = $state(false);
	let liveConnectionState = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
	let permissionMode = $state<PermissionMode>('default');
	let permissionMenuOpen = $state(false);
	let modelMenuOpen = $state(false);
	let contextMenuOpen = $state(false);
	let modelListOpen = $state(false);
	let speedListOpen = $state(false);
	let codexSidebarOpen = $state(false);
	let codexSidebarPinned = $state(false);
	let codexSidebarPinRestored = $state(false);
	let liveContextUsage = $state<Record<string, ContextUsage>>({});
	let threadManagerDialog = $state<{
		mode: 'menu' | 'rename' | 'delete';
		thread: ThreadSummary;
		x: number;
		y: number;
	} | null>(null);
	let threadNameDraft = $state('');
	let threadMutationPending = $state(false);
	let models = $state<ModelOption[]>([]);
	let modelsLoaded = $state(false);
	let customModels = $state<ModelOption[]>([]);
	let customModelInput = $state('');
	let customProviderUrl = $state('');
	let selectedModelId = $state('gpt-5.5');
	let reasoningEffort = $state<ReasoningEffort>('high');
	let serviceTier = $state<ServiceTier | null>(null);
	const MAX_IMAGE_COUNT = 5;
	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
	const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

	const permissionOptions: Array<{
		mode: PermissionMode;
		label: string;
		description: string;
	}> = [
		{
			mode: 'default',
			label: '默认权限',
			description: '需要时请求许可'
		},
		{
			mode: 'auto',
			label: '自动审查',
			description: '由 Codex 自动审查许可'
		},
		{
			mode: 'full',
			label: '完全访问权限',
			description: '无沙箱，自动允许'
		}
	];
	const fallbackModels: ModelOption[] = [
		{
			id: 'gpt-5.5',
			model: 'gpt-5.5',
			displayName: 'GPT-5.5',
			description: 'Frontier model for complex coding, research, and real-world work.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'medium',
			additionalSpeedTiers: ['fast'],
			isDefault: true
		},
		{
			id: 'gpt-5.4',
			model: 'gpt-5.4',
			displayName: 'GPT-5.4',
			description: 'Strong model for everyday coding.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'medium',
			additionalSpeedTiers: ['fast'],
			isDefault: false
		},
		{
			id: 'gpt-5.4-mini',
			model: 'gpt-5.4-mini',
			displayName: 'GPT-5.4-Mini',
			description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'medium',
			additionalSpeedTiers: [],
			isDefault: false
		},
		{
			id: 'gpt-5.3-codex',
			model: 'gpt-5.3-codex',
			displayName: 'GPT-5.3-Codex',
			description: 'Coding-optimized model.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'medium',
			additionalSpeedTiers: [],
			isDefault: false
		},
		{
			id: 'gpt-5.3-codex-spark',
			model: 'gpt-5.3-codex-spark',
			displayName: 'GPT-5.3-Codex-Spark',
			description: 'Ultra-fast coding model.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'high',
			additionalSpeedTiers: [],
			isDefault: false
		},
		{
			id: 'gpt-5.2',
			model: 'gpt-5.2',
			displayName: 'GPT-5.2',
			description: 'Optimized for professional work and long-running agents.',
			hidden: false,
			supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
			defaultReasoningEffort: 'medium',
			additionalSpeedTiers: [],
			isDefault: false
		}
	];
	const reasoningOptions: Array<{ effort: ReasoningEffort; label: string }> = [
		{ effort: 'low', label: '低' },
		{ effort: 'medium', label: '中' },
		{ effort: 'high', label: '高' },
		{ effort: 'xhigh', label: '超高' }
	];
	// ── Derived ──
	const selectedPermission = $derived(
		permissionOptions.find((option) => option.mode === permissionMode) ?? permissionOptions[0]
	);
	const availableModels = $derived.by(() => {
		const base = models.length > 0 ? models : fallbackModels;
		return [...base, ...customModels.filter(c => !base.some(m => m.id === c.id))];
	})
	const selectedModel = $derived.by(() => {
		return (
			availableModels.find((model) => model.id === selectedModelId || model.model === selectedModelId) ??
			availableModels.find((model) => model.isDefault) ??
			availableModels[0] ??
			fallbackModels[0]
		);
	});
	const selectedReasoningLabel = $derived(
		reasoningOptions.find((option) => option.effort === reasoningEffort)?.label ?? reasoningEffort
	);
	const supportsFastTier = $derived(selectedModel.additionalSpeedTiers.includes('fast'));
	const allThreads = $derived(threads.length > 0 ? threads : data.threads);
	const providerOptions = $derived.by(() => {
		const options = new Set<string>();
		for (const thread of allThreads) {
			if (thread.provider) options.add(thread.provider);
		}
		return ['all', ...[...options].sort((a, b) => a.localeCompare(b))];
	});
	const visibleThreads = $derived(
		providerFilter === 'all'
			? allThreads
			: allThreads.filter((t) => t.provider === providerFilter)
	);
	const visibleSelectedThreadId = $derived.by(() => {
		if (selectedThreadId) return selectedThreadId;
		const id = data.selectedThread?.thread.id ?? null;
		if (id && visibleThreads.some((t) => t.id === id)) return id;
		return visibleThreads[0]?.id ?? null;
	});
	const visibleSelectedThread = $derived.by(() => {
		if (selectedThread?.thread.id === visibleSelectedThreadId) return selectedThread;
		if (data.selectedThread?.thread.id === visibleSelectedThreadId) return data.selectedThread;
		return null;
	});
	const currentContextUsage = $derived.by(() => {
		const threadId = visibleSelectedThreadId;
		if (threadId && liveContextUsage[threadId]) return liveContextUsage[threadId];
		return visibleSelectedThread?.contextUsage ?? null;
	});
	const visibleWorkspacePath = $derived(
		workspacePath || data.selectedThread?.thread.cwd || String(data.homePath)
	);
	type WorkspaceOption = {
		key: string;
		path: string;
		name: string;
		meta: string;
		count: number;
		updatedAt: number | null;
	};
	const workspaceOptions = $derived.by(() => {
		const options = new Map<string, WorkspaceOption>();

		function add(path: string, updatedAt: number | null, meta: string) {
			const normalized = normalizeWorkspacePath(path);
			const key = workspaceKey(normalized);
			const existing = options.get(key);
			if (existing) {
				existing.count += 1;
				existing.updatedAt = Math.max(existing.updatedAt ?? 0, updatedAt ?? 0) || existing.updatedAt;
				return;
			}

			options.set(key, {
				key,
				path: normalized,
				name: workspaceName(normalized),
				meta,
				count: 1,
				updatedAt
			});
		}

		for (const thread of allThreads) {
			add(thread.cwd, thread.updatedAt, 'Recent workspace');
		}

		add(String(data.homePath), null, 'Home');

		return [...options.values()].sort((a, b) => {
			const selectedA = workspaceKey(workspacePath || visibleWorkspacePath) === a.key ? 1 : 0;
			const selectedB = workspaceKey(workspacePath || visibleWorkspacePath) === b.key ? 1 : 0;
			if (selectedA !== selectedB) return selectedB - selectedA;
			return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
		});
	});
	const visibleErrorMessage = $derived(errorMessage ?? bootErrorMessage);
	const showingDraftThread = $derived(draftingThread || (!visibleSelectedThread && !loadingThread));
	const selectedSummary = $derived(
		visibleThreads.find((t) => t.id === visibleSelectedThreadId) ?? null
	);
	const pageTitle = $derived.by(() => {
		const currentSessionName =
			selectedSummary?.title ??
			visibleSelectedThread?.thread.title ??
			(showingDraftThread ? 'New thread' : 'Web Console');
		return `codex - ${currentSessionName}`;
	});
	const historicalTurns = $derived.by(() =>
		(visibleSelectedThread?.turns ?? []).map((turn) =>
			isActiveTurn(turn) ? turn : { ...turn, entries: turn.entries.filter((entry) => entry.kind !== 'reasoning') }
		)
	);
	const hasHistoricalTurns = $derived(historicalTurns.length > 0);
	const visibleLiveEntryList = $derived.by(() =>
		filterHistoricalLiveEntries(Object.values(liveEntries), visibleSelectedThread).filter(hasRenderableLiveEntry)
	);
	type ProgressItem = {
		id: string;
		text: string;
		status: 'pending' | 'active' | 'done';
	};
	const latestProgressEntry = $derived.by(() => {
		const entries: TimelineEntry[] = [];
		for (const turn of visibleSelectedThread?.turns ?? []) {
			entries.push(...turn.entries);
		}
		entries.push(...visibleLiveEntryList);

		const structured = entries
			.filter((entry) => entry.kind === 'plan' && entry.text?.trim())
			.filter((entry) => parseProgressItems(entry.text ?? '').length > 0)
			.at(-1);
		if (structured) return structured;

		const summary = entries
			.filter((entry) => entry.kind === 'assistant' && entry.phase === 'final_answer' && entry.text?.trim())
			.map((entry) => ({ ...entry, text: extractProgressSummaryText(entry.text ?? '') }))
			.filter((entry) => entry.text && parseProgressItems(entry.text).length > 0)
			.at(-1);
		return summary ?? null;
	});
	const progressItems = $derived.by(() => parseProgressItems(latestProgressEntry?.text ?? ''));
	const hasProgressItems = $derived(progressItems.length > 0);
	const progressSummary = $derived.by(() => {
		const total = progressItems.length;
		const done = progressItems.filter((item) => item.status === 'done').length;
		const active = progressItems.some((item) => item.status === 'active');
		const allDone = total > 0 && done === total;
		return { total, done, active, allDone };
	});
	const codexSidebarVisible = $derived(hasProgressItems && (codexSidebarOpen || codexSidebarPinned));
	let runningTurnId = $state<string | null>(null);
	let errorClearedAt = $state(0);
	const historicalRunningTurnId = $derived.by(() => findActiveTurnId(visibleSelectedThread));
	const liveRunningTurnId = $derived.by(() => {
		if (!runningTurnId) return null;
		const detail = visibleSelectedThread;
		if (!detail) return runningTurnId;

		const matchingTurn = detail.turns.find((turn) => turn.id === runningTurnId);
		if (matchingTurn) return isActiveTurn(matchingTurn) ? runningTurnId : null;

		return isActiveThreadStatus(detail.thread.status) ? runningTurnId : null;
	});
	const interruptableTurnId = $derived(historicalRunningTurnId ?? liveRunningTurnId);

	const liveConnectionWarning = $derived.by(() => {
		if (!authenticated) return null;
		if (liveConnectionState === 'connecting') return 'Connecting…';
		if (liveConnectionState === 'reconnecting') return 'Disconnected. Reconnecting…';
		return null;
	});
	const contextFillWidth = $derived(
		currentContextUsage?.percentage === null || currentContextUsage?.percentage === undefined
			? 0
			: Math.min(100, Math.max(0, currentContextUsage.percentage))
	);
	const LAST_THREAD_STORAGE_KEY = 'lastThreadId';
	const CODEX_SIDEBAR_PINNED_STORAGE_KEY = 'codexProgressSidebarPinned';

	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}
			await update();
		};
	};

	// ── Theme ──
	let currentTheme = $state<'dark' | 'light'>('dark');

	$effect(() => {
		const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') as 'dark' | 'light') : null;
		if (saved === 'dark' || saved === 'light') currentTheme = saved;
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		codexSidebarPinned = localStorage.getItem(CODEX_SIDEBAR_PINNED_STORAGE_KEY) === 'true';
		codexSidebarPinRestored = true;
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		if (!codexSidebarPinRestored) return;
		localStorage.setItem(CODEX_SIDEBAR_PINNED_STORAGE_KEY, String(codexSidebarPinned));
	});

	$effect(() => {
		if (!hasProgressItems && !codexSidebarPinned) {
			codexSidebarOpen = false;
		}
	});

	function cycleTheme() {
		const root = document.documentElement;
		const next: typeof currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('theme', next);
		root.classList.remove('light', 'dark');
		root.classList.add(next);
		currentTheme = next;
	}

	function parseProgressItems(text: string): ProgressItem[] {
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		const items: ProgressItem[] = [];
		for (const [index, line] of lines.entries()) {
			let status: ProgressItem['status'] | null = null;
			let content = line;

			const checkbox = content.match(/^(?:[-*+]|\d+[.)])?\s*\[([ xX~\-])\]\s*(.+)$/);
			if (checkbox) {
				const marker = checkbox[1];
				status = marker.toLowerCase() === 'x' ? 'done' : marker === '~' || marker === '-' ? 'active' : 'pending';
				content = checkbox[2];
			} else {
				const statusPrefix = content.match(/^(?:[-*+]|\d+[.)])?\s*(完成|已完成|done|completed|进行中|处理中|正在|in progress|active|待处理|等待|pending)[:：]\s*(.+)$/i);
				if (!statusPrefix) continue;
				const marker = statusPrefix[1].toLowerCase();
				status =
					marker.includes('完成') || marker === 'done' || marker === 'completed'
						? 'done'
						: marker.includes('进行') || marker.includes('处理') || marker.includes('正在') || marker === 'in progress' || marker === 'active'
							? 'active'
							: 'pending';
				content = statusPrefix[2];
			}

			content = content.replace(/^\*\*(.+)\*\*$/u, '$1').trim();
			if (!content) continue;

			const normalized = content.toLowerCase();
			if (!status) {
				if (
					/^(done|completed|complete|finished)\b/.test(normalized) ||
					content.startsWith('已完成') ||
					content.includes('已完成') ||
					content.includes('处理完成')
				) {
					status = 'done';
				} else if (
					/^(doing|active|in progress|working|running)\b/.test(normalized) ||
					/进行中|处理中|正在/.test(content)
				) {
					status = 'active';
				} else {
					status = 'pending';
				}
			}

			items.push({
				id: `${index}-${content}`,
				text: content,
				status
			});
		}

		if (!items.some((item) => item.status === 'active')) {
			const firstPending = items.find((item) => item.status === 'pending');
			if (firstPending && items.some((item) => item.status === 'done')) firstPending.status = 'active';
		}

		return items;
	}

	function extractProgressSummaryText(text: string): string {
		const lines = text.split(/\r?\n/);
		const progressLines = lines
			.map((line) => line.trim())
			.filter((line) => /^(completed|pending|in_progress|in-progress|active|running|done)\s{2,}.+/i.test(line))
			.map((line) => {
				const match = line.match(/^(completed|pending|in_progress|in-progress|active|running|done)\s{2,}(.+)$/i);
				if (!match) return '';
				const status = match[1].toLowerCase();
				const marker =
					status === 'completed' || status === 'done'
						? '[x]'
						: status === 'in_progress' || status === 'in-progress' || status === 'active' || status === 'running'
							? '[-]'
							: '[ ]';
				return `- ${marker} ${match[2].trim()}`;
			})
			.filter(Boolean);

		return progressLines.join('\n');
	}

	function progressStatusLabel(status: ProgressItem['status']) {
		if (status === 'done') return '已完成';
		if (status === 'active') return '进行中';
		return '等待中';
	}

	function toggleCodexSidebarPinned() {
		codexSidebarPinned = !codexSidebarPinned;
		if (codexSidebarPinned) codexSidebarOpen = true;
	}

	$effect(() => {
		const saved =
			typeof localStorage !== 'undefined'
				? (localStorage.getItem('permissionMode') as PermissionMode | null)
				: null;
		if (saved === 'default' || saved === 'auto' || saved === 'full') {
			permissionMode = saved;
		}
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const savedModel = localStorage.getItem('modelSelection.model');
		const savedEffort = localStorage.getItem('modelSelection.effort') as ReasoningEffort | null;
		const savedTier = localStorage.getItem('modelSelection.serviceTier') as ServiceTier | null;
				const savedCustomModels = localStorage.getItem('customModels');
				if (savedCustomModels) {
					try {
						const parsed = JSON.parse(savedCustomModels);
						if (Array.isArray(parsed)) customModels = parsed;
					} catch {}
				}
			const savedProviderUrl = localStorage.getItem('customProviderUrl');
			if (savedProviderUrl) customProviderUrl = savedProviderUrl;
		if (savedModel) selectedModelId = savedModel;
		if (isReasoningEffort(savedEffort)) reasoningEffort = savedEffort;
		serviceTier = savedTier === 'fast' || savedTier === 'flex' ? savedTier : null;
	});

	$effect(() => {
		if (!authenticated || modelsLoaded) return;
		modelsLoaded = true;
		void loadModels();
	});

	$effect(() => {
		if (!selectedModel.supportedReasoningEfforts.includes(reasoningEffort)) {
			reasoningEffort = selectedModel.defaultReasoningEffort;
		}
		if (serviceTier === 'fast' && !supportsFastTier) {
			serviceTier = null;
		}
	});

	$effect(() => {
		if (!authenticated || typeof localStorage === 'undefined' || sidebarCollapseRestored) return;
		if (isMobileViewport()) {
			sidebarCollapsed = true;
			sidebarCollapseRestored = true;
			return;
		}

		const saved = localStorage.getItem('sidebarCollapsed');
		if (saved === 'true' || saved === 'false') {
			sidebarCollapsed = saved === 'true';
		}
		sidebarCollapseRestored = true;
	});

	$effect(() => {
		if (!authenticated || typeof localStorage === 'undefined' || !sidebarCollapseRestored) return;
		localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
	});

	$effect(() => {
		if (!authenticated || typeof localStorage === 'undefined' || !selectedThreadId) return;
		localStorage.setItem(LAST_THREAD_STORAGE_KEY, selectedThreadId);
	});

	$effect(() => {
		if (!authenticated || typeof localStorage === 'undefined' || lastThreadRestored) return;
		if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('thread')) {
			lastThreadRestored = true;
			return;
		}
		if (data.selectedThread) {
			lastThreadRestored = true;
			return;
		}
		if (!allThreads.length) return;

		lastThreadRestored = true;
		const savedThreadId = localStorage.getItem(LAST_THREAD_STORAGE_KEY);
		if (savedThreadId && allThreads.some((thread) => thread.id === savedThreadId)) {
			void openThread(savedThreadId);
		} else if (savedThreadId) {
			localStorage.removeItem(LAST_THREAD_STORAGE_KEY);
		}
	});

	function selectPermissionMode(mode: PermissionMode) {
		permissionMode = mode;
		permissionMenuOpen = false;
		contextMenuOpen = false;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('permissionMode', mode);
		}
	}

	function isReasoningEffort(value: unknown): value is ReasoningEffort {
		return value === 'none' ||
			value === 'minimal' ||
			value === 'low' ||
			value === 'medium' ||
			value === 'high' ||
			value === 'xhigh';
	}

	async function loadModels() {
		try {
			const payload = await readJson<{ models: ModelOption[] }>(await fetch('/api/models'));
			if (payload.models.length > 0) models = payload.models;
		} catch {
			// Keep the local fallback list when an older app-server cannot list models.
		}
		// Also fetch from a custom provider URL if configured
		if (customProviderUrl.trim()) {
			try {
				const payload = await readJson<{ models: ModelOption[] }>(
					await fetch('/api/models', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ url: customProviderUrl.trim() })
					})
				);
				if (payload.models.length > 0) {
					const existingIds = new Set(models.map(m => m.id));
					models = [...models, ...payload.models.filter(m => !existingIds.has(m.id))];
				}
			} catch {
				// Custom provider unavailable — silently ignore
			}
		}
	}

	function persistModelSelection() {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('modelSelection.model', selectedModelId);
		localStorage.setItem('modelSelection.effort', reasoningEffort);
		if (serviceTier) localStorage.setItem('modelSelection.serviceTier', serviceTier);
		else localStorage.removeItem('modelSelection.serviceTier');
	}

	function selectModel(model: ModelOption) {
		selectedModelId = model.id;
		if (!model.supportedReasoningEfforts.includes(reasoningEffort)) {
			reasoningEffort = model.defaultReasoningEffort;
		}
		if (serviceTier === 'fast' && !model.additionalSpeedTiers.includes('fast')) {
			serviceTier = null;
		}
		modelListOpen = false;
		contextMenuOpen = false;
		persistModelSelection();
	}

	function selectReasoningEffort(effort: ReasoningEffort) {
		reasoningEffort = effort;
		contextMenuOpen = false;
		persistModelSelection();
	}

	function selectServiceTier(tier: ServiceTier | null) {
		serviceTier = tier;
		speedListOpen = false;
		contextMenuOpen = false;
		persistModelSelection();
	}

	function modelSelectionPayload(): ModelSelection {
		return {
			model: selectedModel.model,
			effort: reasoningEffort,
			serviceTier
		};
	}

	function addCustomModel() {
		const name = customModelInput.trim();
		if (!name) return;
		const id = "custom-" + name;
		const existing = customModels.find(c => c.id === id);
		if (existing) { selectModel(existing); customModelInput = ""; return; }
		const newModel: ModelOption = {
			id,
			model: name,
			displayName: name,
			description: "Custom model",
			hidden: false,
			supportedReasoningEfforts: ["none","low","medium","high"],
			defaultReasoningEffort: "medium",
			additionalSpeedTiers: [],
			isDefault: false
		};
		customModels = [...customModels, newModel];
		selectModel(newModel);
		customModelInput = "";
		localStorage.setItem("customModels", JSON.stringify(customModels));
	}

	function modelShortName(model: ModelOption): string {
		return model.displayName.replace(/^GPT-/i, '').replace(/^gpt-/i, '').replace(/-Codex/i, '');
	}

	function formatTokenCount(value: number | null | undefined): string {
		if (value === null || value === undefined) return '未知';
		const abs = Math.abs(value);
		if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
		if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
		return new Intl.NumberFormat('zh-CN').format(value);
	}

	function contextUsagePercent(usage: ContextUsage | null): string {
		if (usage?.percentage === null || usage?.percentage === undefined) return '--';
		return `${Math.round(usage.percentage)}%`;
	}

	function contextUsageSummary(usage: ContextUsage | null): string {
		if (!usage) return '暂无上下文用量';
		if (usage.usedTokens !== null && usage.totalTokens !== null) {
			return `已用 ${formatTokenCount(usage.usedTokens)} 标记，共 ${formatTokenCount(usage.totalTokens)}`;
		}
		if (usage.usedTokens !== null) return `已用 ${formatTokenCount(usage.usedTokens)} 标记`;
		if (usage.totalTokens !== null) return `窗口 ${formatTokenCount(usage.totalTokens)} 标记，已用未知`;
		return '暂无上下文用量';
	}

	function rememberContextUsage(threadId: string, usage: ContextUsage | null | undefined) {
		if (!usage) return;
		liveContextUsage = { ...liveContextUsage, [threadId]: usage };
		if (selectedThread?.thread.id === threadId) {
			selectedThread = { ...selectedThread, contextUsage: usage };
		}
	}

	function isMobileViewport() {
		return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
	}

	function collapseSidebarOnMobile() {
		if (isMobileViewport()) sidebarCollapsed = true;
	}

	$effect(() => {
		if (!authenticated || typeof window === 'undefined') return;

		const query = window.matchMedia('(max-width: 768px)');
		if (query.matches) sidebarCollapsed = true;

		const handleChange = (event: MediaQueryListEvent) => {
			if (event.matches) sidebarCollapsed = true;
		};

		query.addEventListener('change', handleChange);
		return () => query.removeEventListener('change', handleChange);
	});

	function threadHref(threadId: string | null): string {
		if (!threadId) return '/';
		return `/?${new URLSearchParams({ thread: threadId }).toString()}`;
	}

	function mergeThreadSummaries(
		freshThreads: ThreadSummary[],
		...localThreads: Array<ThreadSummary | null | undefined>
	) {
		const seen = new Set(freshThreads.map((thread) => thread.id));
		const preserved = localThreads.filter(
			(thread): thread is ThreadSummary => Boolean(thread && !seen.has(thread.id))
		);
		return [...preserved, ...freshThreads];
	}

	function buildThreadListSignature(items: ThreadSummary[]): string {
		return items
			.map((thread) =>
				[
					thread.id,
					thread.updatedAt ?? '',
					thread.status,
					thread.title,
					thread.preview,
					thread.cwd,
					thread.provider ?? ''
				].join('\u001f')
			)
			.join('\u001e');
	}

	function sameThreadSummary(left: ThreadSummary, right: ThreadSummary) {
		return left.id === right.id &&
			left.updatedAt === right.updatedAt &&
			left.status === right.status &&
			left.title === right.title &&
			left.preview === right.preview &&
			left.cwd === right.cwd &&
			left.provider === right.provider;
	}

	function sameThreadList(left: ThreadSummary[], right: ThreadSummary[]) {
		return left.length === right.length &&
			left.every((thread, index) => sameThreadSummary(thread, right[index]));
	}

	function isThreadNotFound(error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return /thread not found/i.test(message);
	}

	function normalizeWorkspacePath(path: string): string {
		return path.trim().replace(/[\\/]+$/, '') || String(data.homePath);
	}

	function isWindowsWorkspacePath(path: string): boolean {
		return /^[a-z]:[\\/]/i.test(path);
	}

	function workspaceKey(path: string): string {
		const normalized = normalizeWorkspacePath(path).replace(/\\/g, '/');
		return isWindowsWorkspacePath(path) ? normalized.toLowerCase() : normalized;
	}

	function workspaceName(path: string): string {
		const normalized = normalizeWorkspacePath(path);
		const parts = normalized.split(/[\\/]/).filter(Boolean);
		return parts.at(-1) ?? normalized;
	}

	function workspaceParent(path: string): string {
		const normalized = normalizeWorkspacePath(path);
		const parts = normalized.split(/[\\/]/).filter(Boolean);
		if (parts.length <= 1) return normalized;
		return parts.slice(0, -1).join(normalized.includes('\\') ? '\\' : '/');
	}

	function isSelectedWorkspace(path: string): boolean {
		return workspaceKey(path) === workspaceKey(workspacePath || visibleWorkspacePath);
	}

	function selectWorkspace(path: string) {
		workspacePath = path;
	}

	function closeThreadManagerDialog() {
		threadManagerDialog = null;
		threadNameDraft = '';
		threadMutationPending = false;
	}

	function updateThreadSummaryLocally(updated: ThreadSummary) {
		threads = threads.map((thread) => (thread.id === updated.id ? updated : thread));
		if (selectedThread?.thread.id === updated.id) {
			selectedThread = {
				...selectedThread,
				thread: updated
			};
		}
	}

	function removeThreadLocally(threadId: string) {
		threads = threads.filter((thread) => thread.id !== threadId);
		removeLiveBuffer(threadId);
		if (selectedThreadId === threadId || selectedThread?.thread.id === threadId) {
			clearSelectedThreadState();
			void goto(threadHref(null), { keepFocus: true, noScroll: true });
		}
		if (typeof localStorage !== 'undefined' && localStorage.getItem(LAST_THREAD_STORAGE_KEY) === threadId) {
			localStorage.removeItem(LAST_THREAD_STORAGE_KEY);
		}
	}

	function openThreadManager(thread: ThreadSummary, position: { x: number; y: number }) {
		const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
		const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
		const panelWidth = 360;
		const panelHeight = 260;
		threadManagerDialog = {
			mode: 'menu',
			thread,
			x: Math.max(12, Math.min(position.x, viewportWidth - panelWidth - 12)),
			y: Math.max(12, Math.min(position.y, viewportHeight - panelHeight - 12))
		};
	}

	function beginRenameThread(thread: ThreadSummary) {
		if (!threadManagerDialog) return;
		threadManagerDialog = { ...threadManagerDialog, mode: 'rename', thread };
		threadNameDraft = thread.title;
	}

	function beginDeleteThread(thread: ThreadSummary) {
		if (!threadManagerDialog) return;
		threadManagerDialog = { ...threadManagerDialog, mode: 'delete', thread };
	}

	async function submitThreadRename() {
		const dialog = threadManagerDialog;
		const name = threadNameDraft.trim();
		if (!dialog || dialog.mode !== 'rename') return;
		if (!name) {
			errorMessage = 'Thread name is required.';
			return;
		}

		threadMutationPending = true;
		errorMessage = null;
		try {
			const payload = await readJson<{ thread: ThreadSummary }>(
				await fetch(`/api/threads/${dialog.thread.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name })
				})
			);
			updateThreadSummaryLocally(payload.thread);
			bootErrorMessage = null;
			closeThreadManagerDialog();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			threadMutationPending = false;
		}
	}

	async function submitThreadDelete() {
		const dialog = threadManagerDialog;
		if (!dialog || dialog.mode !== 'delete') return;

		threadMutationPending = true;
		errorMessage = null;
		try {
			await readJson<{ ok: true }>(
				await fetch(`/api/threads/${dialog.thread.id}`, {
					method: 'DELETE'
				})
			);
			bootErrorMessage = null;
			removeThreadLocally(dialog.thread.id);
			closeThreadManagerDialog();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			threadMutationPending = false;
		}
	}

	function clearSelectedThreadState(message?: string) {
		selectedThreadId = null;
		selectedThread = null;
		runningTurnId = null;
		liveEntries = {};
		approvals = [];
		draftingThread = true;
		replyPrompt = '';
		replyImages = [];
		if (message) errorMessage = message;
	}

	function removeLiveBuffer(threadId: string) {
		const { [threadId]: _removed, ...rest } = liveEntryBuffers;
		liveEntryBuffers = rest;
	}

	function flushLiveBuffer(threadId: string) {
		const buffered = liveEntryBuffers[threadId];
		if (!buffered) return;
		liveEntries = { ...buffered, ...liveEntries };
		removeLiveBuffer(threadId);
	}

	function stashCurrentLiveEntries() {
		flushQueuedLiveEntryUpdates();
		if (!selectedThreadId || Object.keys(liveEntries).length === 0) return;
		liveEntryBuffers = {
			...liveEntryBuffers,
			[selectedThreadId]: {
				...(liveEntryBuffers[selectedThreadId] ?? {}),
				...liveEntries
			}
		};
		liveEntries = {};
	}

	type QueuedLiveEntryUpdate = {
		itemId: string;
		threadId: string;
		patch: Partial<TimelineEntry>;
		defaults?: Pick<TimelineEntry, 'kind' | 'label'>;
	};

	const queuedLiveEntryUpdates = new Map<string, QueuedLiveEntryUpdate>();

	function liveEntryQueueKey(threadId: string, itemId: string) {
		return `${threadId}\u0000${itemId}`;
	}

	function queueLiveEntryUpdate(
		itemId: string,
		threadId: string,
		patch: Partial<TimelineEntry>,
		defaults?: Pick<TimelineEntry, 'kind' | 'label'>
	) {
		const key = liveEntryQueueKey(threadId, itemId);
		const current = queuedLiveEntryUpdates.get(key);
		queuedLiveEntryUpdates.set(key, {
			itemId,
			threadId,
			patch: { ...(current?.patch ?? {}), ...patch },
			defaults: defaults ?? current?.defaults
		});

		if (liveEntryFlushFrame !== null) return;
		if (typeof window === 'undefined') {
			flushQueuedLiveEntryUpdates();
			return;
		}

		liveEntryFlushFrame = window.requestAnimationFrame(() => {
			liveEntryFlushFrame = null;
			flushQueuedLiveEntryUpdates();
		});
	}

	function appendLiveEntryField(
		itemId: string,
		threadId: string,
		field: 'text' | 'output',
		delta: string,
		patch: Partial<TimelineEntry>,
		defaults: Pick<TimelineEntry, 'kind' | 'label'>
	) {
		const queued = queuedLiveEntryUpdates.get(liveEntryQueueKey(threadId, itemId));
		const queuedValue = queued?.patch[field];
		const currentValue = getLiveEntry(threadId, itemId)?.[field];
		queueLiveEntryUpdate(
			itemId,
			threadId,
			{
				...patch,
				[field]: `${typeof queuedValue === 'string' ? queuedValue : (currentValue ?? '')}${delta}`
			},
			defaults
		);
	}

	function flushQueuedLiveEntryUpdates() {
		if (liveEntryFlushFrame !== null && typeof window !== 'undefined') {
			window.cancelAnimationFrame(liveEntryFlushFrame);
			liveEntryFlushFrame = null;
		}
		if (queuedLiveEntryUpdates.size === 0) return;
		const updates = [...queuedLiveEntryUpdates.values()];
		queuedLiveEntryUpdates.clear();
		for (const update of updates) {
			updateLiveEntry(update.itemId, update.threadId, update.patch, update.defaults);
		}
	}

	function removeLiveEntry(threadId: string, itemId: string) {
		queuedLiveEntryUpdates.delete(liveEntryQueueKey(threadId, itemId));
		const selected = threadId === selectedThreadId;
		const entries = selected ? liveEntries : (liveEntryBuffers[threadId] ?? {});
		if (!(itemId in entries)) return;
		const { [itemId]: _removed, ...next } = entries;
		if (selected) {
			liveEntries = next;
		} else {
			liveEntryBuffers = { ...liveEntryBuffers, [threadId]: next };
		}
	}

	function getLiveEntry(threadId: string, itemId: string) {
		const queued = queuedLiveEntryUpdates.get(liveEntryQueueKey(threadId, itemId));
		if (queued) {
			const selected = threadId === selectedThreadId;
			const entries = selected ? liveEntries : (liveEntryBuffers[threadId] ?? {});
			const current = entries[itemId];
			if (current) return mergeEntry(current, queued.patch);
		}
		return threadId === selectedThreadId ? liveEntries[itemId] : liveEntryBuffers[threadId]?.[itemId];
	}

	function isTerminalStatus(status: string | null | undefined) {
		const value = status?.toLowerCase() ?? '';
		return (
			value.includes('completed') ||
			value.includes('finished') ||
			value.includes('failed') ||
			value.includes('cancel') ||
			value.includes('interrupt') ||
			value.includes('error')
		);
	}

	function isActiveThreadStatus(status: string | null | undefined) {
		const value = status?.toLowerCase() ?? '';
		return (
			value.includes('active') ||
			value.includes('running') ||
			value.includes('executing') ||
			value.includes('pending') ||
			value.includes('started')
		);
	}

	function isActiveTurn(turn: ThreadDetail['turns'][number]) {
		return turn.completedAt === null && !isTerminalStatus(turn.status);
	}

	function findActiveTurnId(detail: ThreadDetail | null) {
		const turns = detail?.turns ?? [];
		for (let i = turns.length - 1; i >= 0; i--) {
			if (isActiveTurn(turns[i])) return turns[i].id;
		}
		return null;
	}

	function settledHistoricalTurnIds(detail: ThreadDetail) {
		return new Set(
			detail.turns
				.filter((turn) => !isActiveTurn(turn))
				.map((turn) => turn.id)
		);
	}

	function isRuntimeOnlyEntry(entry: TimelineEntry) {
		return entry.kind === 'reasoning';
	}

	function hasRuntimeReasoningContent(entry: TimelineEntry) {
		return entry.kind === 'reasoning' && Boolean(entry.text?.trim());
	}

	function hasRenderableLiveEntry(entry: TimelineEntry) {
		if (entry.kind === 'reasoning') { return hasRuntimeReasoningContent(entry); }
		if (entry.kind === 'assistant' && !(entry.text?.trim() || entry.images?.length || entry.changes?.length)) return false;
		return true
	}

	function normalizedEntryContent(entry: TimelineEntry) {
		return `${entry.text ?? ''}\u0000${entry.output ?? ''}`.trim();
	}

	function hasEquivalentHistoricalEntry(entry: TimelineEntry, detail: ThreadDetail) {
		if (!entry.turnId) return false;
		const turn = detail.turns.find((item) => item.id === entry.turnId);
		if (!turn) return false;
		const liveContent = normalizedEntryContent(entry);
		if (!liveContent) return false;
		return turn.entries.some(
			(historical) =>
				historical.kind === entry.kind &&
				(entry.phase == null || historical.phase === entry.phase) &&
				normalizedEntryContent(historical) === liveContent
		);
	}

	function isHistoricalLiveEntry(
		entry: TimelineEntry,
		historicalIds: Set<string>,
		settledTurnIds: Set<string>,
		historicalUserTexts: Set<string>,
		detail: ThreadDetail
	) {
		if (historicalIds.has(entry.id)) return true;
		if (entry.kind === 'user' && entry.text && historicalUserTexts.has(entry.text.trim())) return true;
		if (hasEquivalentHistoricalEntry(entry, detail)) return true;
		return Boolean(entry.turnId && settledTurnIds.has(entry.turnId));
	}

	function filterHistoricalLiveEntries(entries: TimelineEntry[], detail: ThreadDetail | null) {
		if (!detail) return entries.filter(hasRenderableLiveEntry);
		const historicalIds = new Set(detail.turns.flatMap((turn) => turn.entries.map((entry) => entry.id)));
		const settledTurnIds = settledHistoricalTurnIds(detail);
		const historicalUserTexts = new Set(
			detail.turns
				.flatMap((turn) => turn.entries)
				.filter((entry) => entry.kind === 'user' && entry.text?.trim())
				.map((entry) => entry.text?.trim() ?? '')
		);
		return entries.filter((entry) => !isHistoricalLiveEntry(entry, historicalIds, settledTurnIds, historicalUserTexts, detail));
	}

	function reconcileRunningTurn(detail: ThreadDetail) {
		// Don't re-arm while the error cooldown is active
		if (errorClearedAt && Date.now() - errorClearedAt < 10_000) return;

		const activeTurnId = findActiveTurnId(detail);
		if (activeTurnId) {
			runningTurnId = runningTurnId ?? activeTurnId;
			return;
		}

		const matchingTurn = runningTurnId
			? detail.turns.find((turn) => turn.id === runningTurnId)
			: null;
		if (!isActiveThreadStatus(detail.thread.status) || (matchingTurn && !isActiveTurn(matchingTurn))) {
			runningTurnId = null;
		}
	}

	function mergeEntry(base: TimelineEntry, patch: Partial<TimelineEntry>): TimelineEntry {
		const startedAt =
			base.startedAt && patch.startedAt
				? Math.min(base.startedAt, patch.startedAt)
				: (base.startedAt ?? patch.startedAt ?? Date.now());
		const status =
			isTerminalStatus(base.status) && !isTerminalStatus(patch.status)
				? base.status
				: (patch.status ?? base.status);
		return {
			...base,
			...patch,
			status,
			startedAt,
			completedAt: patch.completedAt ?? base.completedAt ?? null,
			text:
				(base.kind === 'reasoning' || patch.kind === 'reasoning') && base.text && !patch.text
					? base.text
					: (patch.text ?? base.text ?? ''),
			output:
				patch.output && patch.output.length > 0
					? patch.output
					: (base.output ?? patch.output ?? '')
		};
	}

	function pruneLiveEntriesFromDetail(detail: ThreadDetail) {
		const historicalIds = new Set(detail.turns.flatMap((turn) => turn.entries.map((entry) => entry.id)));
		const settledTurnIds = settledHistoricalTurnIds(detail);
		const historicalUserTexts = new Set(
			detail.turns
				.flatMap((turn) => turn.entries)
				.filter((entry) => entry.kind === 'user' && entry.text?.trim())
				.map((entry) => entry.text?.trim() ?? '')
		);
		const keepEntry = ([itemId, entry]: [string, TimelineEntry]) =>
			!historicalIds.has(itemId) &&
			!(entry.kind === 'user' && entry.text && historicalUserTexts.has(entry.text.trim())) &&
			!hasEquivalentHistoricalEntry(entry, detail) &&
			!(entry.turnId && settledTurnIds.has(entry.turnId)) &&
			hasRenderableLiveEntry(entry);

		if (detail.thread.id === selectedThreadId) {
			liveEntries = Object.fromEntries(Object.entries(liveEntries).filter(keepEntry));
		}

		const buffered = liveEntryBuffers[detail.thread.id];
		if (buffered) {
			liveEntryBuffers = {
				...liveEntryBuffers,
				[detail.thread.id]: Object.fromEntries(Object.entries(buffered).filter(keepEntry))
			};
		}

	}

	function updateThreadUrl(threadId: string | null) {
		const href = threadHref(threadId);
		if (typeof window === 'undefined') return;
		if (`${window.location.pathname}${window.location.search}` === href) return;
		window.history.pushState({}, '', href);
	}

	function pendingTurnId() {
		return `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	function createOptimisticTurn(prompt: string): ThreadDetail['turns'][number] {
		const id = pendingTurnId();
		return {
			id,
			status: 'starting',
			startedAt: Date.now(),
			completedAt: null,
			durationMs: null,
			entries: [
				{
					id: `${id}-user`,
					kind: 'user',
					label: 'You',
					text: prompt
				}
			]
		};
	}

	function appendOptimisticTurn(prompt: string) {
		if (!selectedThread) return null;
		const turn = createOptimisticTurn(prompt);
		selectedThread = {
			...selectedThread,
			thread: {
				...selectedThread.thread,
				status: 'active',
				updatedAt: Date.now()
			},
			turns: [...selectedThread.turns, turn]
		};
		runningTurnId = turn.id;
		return turn.id;
	}

	function removeOptimisticTurn(turnId: string | null) {
		if (!turnId || !selectedThread) return;
		selectedThread = {
			...selectedThread,
			turns: selectedThread.turns.filter((turn) => turn.id !== turnId)
		};
		if (runningTurnId === turnId) runningTurnId = null;
	}

	function replaceOptimisticTurnId(realTurnId: string) {
		if (!selectedThread) return;
		const index = selectedThread.turns.findIndex((turn) => turn.id.startsWith('pending-') && isActiveTurn(turn));
		if (index < 0) return;
		const turns = [...selectedThread.turns];
		const turn = turns[index];
		turns[index] = {
			...turn,
			id: realTurnId,
			status: 'inprogress',
			entries: turn.entries.map((entry) => ({
				...entry,
				id: entry.id === `${turn.id}-user` ? `${realTurnId}-user` : entry.id,
				turnId: realTurnId
			}))
		};
		selectedThread = { ...selectedThread, turns };
	}

	function mergeLocalActiveTurns(detail: ThreadDetail): ThreadDetail {
		if (!selectedThread || selectedThread.thread.id !== detail.thread.id) return detail;
		const historicalTexts = new Set(
			detail.turns
				.flatMap((turn) => turn.entries)
				.filter((entry) => entry.kind === 'user' && entry.text?.trim())
				.map((entry) => entry.text?.trim() ?? '')
		);
		const historicalTurnIds = new Set(detail.turns.map((turn) => turn.id));
		const localTurns = selectedThread.turns.filter((turn) => {
			if (!isActiveTurn(turn) || historicalTurnIds.has(turn.id)) return false;
			const prompt = turn.entries.find((entry) => entry.kind === 'user')?.text?.trim();
			return Boolean(prompt && !historicalTexts.has(prompt));
		});
		if (localTurns.length === 0) return detail;
		return {
			...detail,
			turns: [...detail.turns, ...localTurns]
		};
	}

	async function openThread(threadId: string | null) {
		collapseSidebarOnMobile();
		if (!threadId) {
			stashCurrentLiveEntries();
			selectedThreadId = null;
			selectedThread = null;
			runningTurnId = null;
			draftingThread = true;
			followLiveOutput = true;
			errorMessage = null;
			liveEntries = {};
			approvals = [];
			replyPrompt = '';
			updateThreadUrl(null);
			return;
		}
		if (selectedThreadId !== threadId) {
			stashCurrentLiveEntries();
			liveEntries = {};
			runningTurnId = null;
		}
		draftingThread = false;
		selectedThreadId = threadId;
		flushLiveBuffer(threadId);
		followLiveOutput = true;
		errorMessage = null;
		updateThreadUrl(threadId);
	}

	function updateLiveEntry(itemId: string, threadId: string, patch: Partial<TimelineEntry>, defaults?: Pick<TimelineEntry, 'kind' | 'label'>) {
		const selected = threadId === selectedThreadId;
		const entries = selected ? liveEntries : (liveEntryBuffers[threadId] ?? {});
		const current = entries[itemId];
		const base = current ?? (defaults ? { id: itemId, ...defaults, text: '', output: '', startedAt: Date.now() } : { id: itemId, kind: 'system' as const, label: 'System', text: '', output: '', startedAt: Date.now() });
		const next = { ...entries, [itemId]: mergeEntry(base, patch) };

		if (selected) {
			liveEntries = next;
		} else {
			liveEntryBuffers = { ...liveEntryBuffers, [threadId]: next };
		}
	}

	function completeLiveEntriesForTurn(threadId: string, turnId: string) {
		flushQueuedLiveEntryUpdates();
		const entries = threadId === selectedThreadId ? liveEntries : (liveEntryBuffers[threadId] ?? {});
		let changed = false;
		const next = Object.fromEntries(
			Object.entries(entries).flatMap(([itemId, entry]) => {
				if (entry.turnId !== turnId || entry.completedAt) return [[itemId, entry]];
				if (entry.kind === "reasoning") { changed = true; return []; }
				changed = true;
				const completedAt = Date.now();
				return [[itemId, mergeEntry(entry, { status: entry.kind === "command" ? "completed" : entry.status, completedAt, durationMs: entry.startedAt ? completedAt - entry.startedAt : entry.durationMs })]];
			})
		);
		if (!changed) return;
		if (threadId === selectedThreadId) {
			liveEntries = next;
		} else {
			liveEntryBuffers = { ...liveEntryBuffers, [threadId]: next };
		}
	}

	async function readJson<T>(response: Response): Promise<T> {
		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			throw new Error(payload?.error ?? `Request failed: ${response.status}`);
		}
		return response.json() as Promise<T>;
	}

	$effect(() => {
		threads = [...data.threads];
		threadListSignature = buildThreadListSignature(data.threads);
		selectedThread = data.selectedThread;
		selectedThreadId = data.selectedThread?.thread.id ?? null;
		runningTurnId = null;
		approvals = data.selectedThread?.approvals ?? [];
		workspacePath = data.selectedThread?.thread.cwd ?? String(data.homePath);
		draftingThread = !data.selectedThread;
		bootErrorMessage = data.codexError ? String(data.codexError) : null;
	});
	// On mount, if the server returned empty threads (likely due to cold-start
	// timeout), trigger a client-side fetch immediately instead of waiting for
	// the SSE connection to be established.
	let initialThreadsLoaded = false;
	$effect(() => {
		if (initialThreadsLoaded) return;
		if (authenticated && threads.length === 0 && !bootErrorMessage && !selectedThread) {
			initialThreadsLoaded = true;
			void loadThreads();
		}
	});

	let loadThreadsInFlight = false;
	let loadThreadsQueued = false;

	async function loadThreads() {
		if (loadThreadsInFlight) {
			loadThreadsQueued = true;
			return;
		}
		loadThreadsInFlight = true;
		try {
			const payload = await readJson<ThreadListResponse>(
				await fetch('/api/threads', { cache: 'no-store' })
			);
			bootErrorMessage = null;
			const localSelection =
				selectedThread?.thread ?? threads.find((thread) => thread.id === selectedThreadId);
			const nextThreads = mergeThreadSummaries(payload.threads, localSelection);
			threadListSignature = payload.signature;
			if (!sameThreadList(threads, nextThreads)) {
				threads = nextThreads;
			}
		} catch {
			// Swallow — will retry on next trigger.
		} finally {
			loadThreadsInFlight = false;
			if (loadThreadsQueued) {
				loadThreadsQueued = false;
				void loadThreads();
			}
		}
	}

	type ScrollSnapshot = { mode: 'window' | 'element'; top: number; stickToBottom: boolean };

	async function loadThread(threadId: string, options: { silent?: boolean; full?: boolean } = {}) {
		const silent = options.silent ?? false;
		const snapshot = silent ? captureScrollSnapshot() : null;
		if (!silent) loadingThread = true;
		try {
			const keepFullHistory =
				options.full ??
				(
					selectedThread?.thread.id === threadId &&
					(selectedThread.omittedTurnCount ?? 0) === 0 &&
					selectedThread.turns.length > 5
				);
			const suffix = keepFullHistory ? '' : '?tailTurns=5';
			const payload = await readJson<{ detail: ThreadDetail }>(await fetch(`/api/threads/${threadId}${suffix}`));
			const detail = mergeLocalActiveTurns(payload.detail);
			bootErrorMessage = null;
			errorMessage = null;
			selectedThread = detail;
			reconcileRunningTurn(detail);
			approvals = detail.approvals;
			pruneLiveEntriesFromDetail(detail);
			if (silent) {
				await tick();
				restoreScrollSnapshot(snapshot);
				await new Promise<void>(r => requestAnimationFrame(() => { restoreScrollSnapshot(snapshot); r(); }));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) {
				clearSelectedThreadState(message);
				await goto(threadHref(null), { keepFocus: true, noScroll: true });
			} else {
				errorMessage = message;
			}
		} finally {
			if (!silent) loadingThread = false;
		}
	}

	async function openBrowser(path: string) {
		try {
			const payload = await readJson<{ listing: DirectoryListing }>(await fetch(`/api/fs?path=${encodeURIComponent(path || visibleWorkspacePath)}`));
			listing = payload.listing;
			browserOpen = true;
			errorMessage = null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	function hasComposerContent(prompt: string, images: string[]) {
		return Boolean(prompt.trim() || images.length > 0);
	}

	async function createThread() {
		const cwd = (workspacePath || visibleWorkspacePath).trim();
		if (!cwd || !hasComposerContent(newPrompt, pendingImages)) { errorMessage = 'Workspace path and prompt or image are required.'; return; }
		submitting = true;
		errorMessage = null;
		const prompt = newPrompt.trim();
		const images = [...pendingImages];
		try {
			followLiveOutput = true;
			const payload = await readJson<{ thread: ThreadSummary }>(await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, prompt, permissionMode, modelSelection: modelSelectionPayload(), images: images.length > 0 ? images : undefined }) }));
			bootErrorMessage = null;
			newPrompt = '';
			pendingImages = [];
			draftingThread = false;
			const optimisticTurn = createOptimisticTurn(prompt);
			threads = [payload.thread, ...threads.filter((thread) => thread.id !== payload.thread.id)];
			threadListSignature = buildThreadListSignature(threads);
			selectedThreadId = payload.thread.id;
			selectedThread = {
				thread: payload.thread,
				turns: [optimisticTurn],
				approvals: [],
				omittedTurnCount: 0
			};
			runningTurnId = optimisticTurn.id;
			approvals = [];
			liveEntries = {};
			updateThreadUrl(payload.thread.id);
			void loadThreads();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) clearSelectedThreadState(message);
			else errorMessage = message;
		}
		finally { submitting = false; }
	}

	async function sendReply() {
		if (!selectedThread || !hasComposerContent(replyPrompt, replyImages)) return;
		if (interruptableTurnId) { errorMessage = 'This turn is still running. Stop it before sending another reply.'; return; }
		const thread = selectedThread;
		const prompt = replyPrompt.trim();
		const images = [...replyImages];
		submitting = true;
		followLiveOutput = true;
		errorMessage = null;
		replyPrompt = '';
		replyImages = [];
		const optimisticTurnId = appendOptimisticTurn(prompt);
		await tick();
		scrollMainTo('bottom', 'auto');
		try {
			await readJson<{ ok: true }>(await fetch(`/api/threads/${thread.thread.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: thread.thread.cwd, prompt, permissionMode, modelSelection: modelSelectionPayload(), images: images.length > 0 ? images : undefined }) }));
			bootErrorMessage = null;
		} catch (error) { removeOptimisticTurn(optimisticTurnId); replyPrompt = prompt; replyImages = images; errorMessage = error instanceof Error ? error.message : String(error); }
		finally { submitting = false; }
	}

	async function interruptCurrentTurn() {
		if (!selectedThread || !interruptableTurnId) return;
		interrupting = true;
		errorMessage = null;
		try {
			await readJson<{ ok: true }>(await fetch(`/api/threads/${selectedThread.thread.id}/interrupt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: interruptableTurnId }) }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) clearSelectedThreadState(message);
			else errorMessage = message;
		}
		finally { interrupting = false; }
	}

	function startDraftThread() {
		collapseSidebarOnMobile();
		draftingThread = true;
		followLiveOutput = true;
		errorMessage = null;
		liveEntries = {};
		approvals = [];
		newPrompt = '';
		replyPrompt = '';
		pendingImages = [];
		replyImages = [];
		workspacePath = visibleSelectedThread?.thread.cwd ?? String(data.homePath);
		void openThread(null);
	}

	async function resolveApproval(requestId: string, decision: 'accept' | 'acceptForSession' | 'decline') {
		await readJson<{ ok: true }>(await fetch(`/api/approvals/${requestId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }));
		bootErrorMessage = null;
	}

	function submitOnEnter(event: KeyboardEvent, submit: () => void) {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey) return;
		event.preventDefault();
		submit();
	}

	function dataUriBytes(dataUri: string) {
		const base64 = dataUri.split(',', 2)[1] ?? '';
		return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
	}

	function currentImageBytes(target: 'new' | 'reply') {
		const list = target === 'new' ? pendingImages : replyImages;
		return list.reduce((sum, image) => sum + dataUriBytes(image), 0);
	}

	function addImages(files: FileList | File[], target: 'new' | 'reply') {
		let currentCount = target === 'new' ? pendingImages.length : replyImages.length;
		let totalBytes = currentImageBytes(target);
		for (const file of files) {
			if (!file.type.startsWith('image/')) continue;
			if (currentCount >= MAX_IMAGE_COUNT) {
				errorMessage = `最多只能添加 ${MAX_IMAGE_COUNT} 张图片。`;
				break;
			}
			if (file.size > MAX_IMAGE_BYTES || totalBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
				errorMessage = '图片过大：单张最多 10 MB，总计最多 20 MB。';
				continue;
			}
			currentCount += 1;
			totalBytes += file.size;
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result;
				if (typeof result === 'string') {
					if (target === 'new') pendingImages = [...pendingImages, result];
					else replyImages = [...replyImages, result];
				}
			};
			reader.readAsDataURL(file);
		}
	}

	$effect(() => {
		if (typeof ResizeObserver === 'undefined' || !mobileComposerElement) return;

		const updateComposerSpace = () => {
			const height = Math.ceil(mobileComposerElement?.getBoundingClientRect().height ?? 148);
			document.documentElement.style.setProperty('--mobile-composer-space', `${height}px`);
		};

		updateComposerSpace();
		const observer = new ResizeObserver(updateComposerSpace);
		observer.observe(mobileComposerElement);
		return () => observer.disconnect();
	});

	function removeImage(index: number, target: 'new' | 'reply') {
		if (target === 'new') pendingImages = pendingImages.filter((_, i) => i !== index);
		else replyImages = replyImages.filter((_, i) => i !== index);
	}

	function handleImagePaste(event: ClipboardEvent, target: 'new' | 'reply') {
		const items = event.clipboardData?.items;
		if (!items) return;
		const files: File[] = [];
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}
		if (files.length > 0) {
			event.preventDefault();
			addImages(files, target);
		}
	}

	function handleImageDrop(event: DragEvent, target: 'new' | 'reply') {
		const files = event.dataTransfer?.files;
		if (!files) return;
		const imageFiles = [...files].filter((f) => f.type.startsWith('image/'));
		if (imageFiles.length > 0) {
			event.preventDefault();
			addImages(imageFiles, target);
		}
	}

	function scrollTarget(): HTMLElement | Window {
		if (!mainScroller) return window;
		const body = mainScroller.querySelector<HTMLElement>('.detail-body');
		if (body && getComputedStyle(body).overflowY !== 'visible') return body;
		return window;
	}

	function scrollMainTo(position: 'top' | 'bottom', behavior: ScrollBehavior = 'smooth') {
		const target = scrollTarget();
		if (target === window) {
			window.scrollTo({ top: position === 'top' ? 0 : document.documentElement.scrollHeight, behavior });
		} else {
			const element = target as HTMLElement;
			element.scrollTo({ top: position === 'top' ? 0 : element.scrollHeight, behavior });
		}
	}

	function getHistoricalTurnElements(): HTMLElement[] {
		if (!mainScroller) return [];
		return [...mainScroller.querySelectorAll<HTMLElement>('[data-turn-id]')];
	}

	function measureActiveTurnIndex(): number {
		const elements = getHistoricalTurnElements();
		if (!elements.length || !mainScroller) return -1;
		const target = scrollTarget();
		const threshold = target === window ? 24 : (target as HTMLElement).getBoundingClientRect().top + 24;
		let idx = 0;
		for (const [i, el] of elements.entries()) {
			if (el.getBoundingClientRect().top <= threshold) { idx = i; continue; }
			break;
		}
		return idx;
	}

	function syncActiveTurnIndex() {
		if (Date.now() < turnNavigationLockUntil) return;
		const next = measureActiveTurnIndex();
		if (next >= 0) activeTurnIndex = next;
	}

	function scrollTurnIntoView(index: number) {
		const elements = getHistoricalTurnElements();
		const el = elements[index];
		if (!el || !mainScroller) return;
		turnNavigationLockUntil = Date.now() + 450;
		const offset = 24;
		const target = scrollTarget();
		if (target === window) {
			window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - offset, behavior: 'smooth' });
		} else {
			const element = target as HTMLElement;
			element.scrollTo({ top: element.scrollTop + el.getBoundingClientRect().top - element.getBoundingClientRect().top - offset, behavior: 'smooth' });
		}
		activeTurnIndex = index;
	}

	function captureScrollSnapshot(): ScrollSnapshot | null {
		const target = scrollTarget();
		if (target === window) {
			const top = window.scrollY;
			return { mode: 'window', top, stickToBottom: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) - top < 80 };
		}
		const element = target as HTMLElement;
		const top = element.scrollTop;
		return { mode: 'element', top, stickToBottom: Math.max(0, element.scrollHeight - element.clientHeight) - top < 80 };
	}

	function restoreScrollSnapshot(snapshot: ScrollSnapshot | null) {
		if (!snapshot || !mainScroller) return;
		scrollRestoreLockUntil = Date.now() + 300;
		if (snapshot.mode === 'window') {
			window.scrollTo({ top: snapshot.stickToBottom ? document.documentElement.scrollHeight : snapshot.top, behavior: 'auto' });
			return;
		}
		const target = scrollTarget();
		if (target !== window) {
			const element = target as HTMLElement;
			element.scrollTo({ top: snapshot.stickToBottom ? element.scrollHeight : snapshot.top, behavior: 'auto' });
		}
	}

	function isNearBottom(): boolean {
		const target = scrollTarget();
		if (target === window) {
			return Math.max(0, document.documentElement.scrollHeight - window.innerHeight) - window.scrollY < 96;
		}
		const element = target as HTMLElement;
		return Math.max(0, element.scrollHeight - element.clientHeight) - element.scrollTop < 96;
	}

	function syncScrollState() {
		const nearBottom = isNearBottom();
		followLiveOutput = nearBottom;
		showScrollToBottom = !nearBottom;
	}

	function jumpTurn(dir: 'previous' | 'next') {
		const n = getHistoricalTurnElements().length;
		if (!n) return;
		scrollTurnIntoView(dir === 'previous' ? Math.max(0, activeTurnIndex - 1) : Math.min(n - 1, activeTurnIndex + 1));
	}

	function maybeFollowLiveOutput(threadId: string) {
		if (threadId !== selectedThreadId || !followLiveOutput) return;
		if (followLiveOutputFrame !== null) return;
		followLiveOutputFrame = -1;
		void tick().then(() => {
			if (typeof window === 'undefined') {
				followLiveOutputFrame = null;
				if (followLiveOutput) scrollMainTo('bottom', 'auto');
				return;
			}
			followLiveOutputFrame = window.requestAnimationFrame(() => {
				followLiveOutputFrame = null;
				if (followLiveOutput) scrollMainTo('bottom', 'auto');
			});
		});
	}

	function shouldPollEvents() {
		if (forceEventPolling) return true;
		if (typeof window === 'undefined') return false;
		// Prefer SSE for real-time streaming; polling is a fallback only.
		return false;
	}

	function abortableDelay(ms: number, signal: AbortSignal) {
		return new Promise<void>((resolve) => {
			if (signal.aborted) {
				resolve();
				return;
			}

			const timeout = window.setTimeout(resolve, ms);
			signal.addEventListener(
				'abort',
				() => {
					window.clearTimeout(timeout);
					resolve();
				},
				{ once: true }
			);
		});
	}

	function applySequencedEvents(events: SequencedConsoleEvent[]) {
		for (const { id, event } of events) {
			lastEventId = Math.max(lastEventId, id);
			handleEvent(event);
		}
	}

	async function pollEvents(signal: AbortSignal) {
		liveConnectionState = 'connecting';

		while (!signal.aborted) {
			try {
				const params = new URLSearchParams({
					transport: 'poll',
					wait: '1500'
				});
				if (lastEventId > 0) params.set('since', String(lastEventId));
				const payload = await readJson<{ events: SequencedConsoleEvent[]; latestId: number }>(
					await fetch(`/api/events?${params.toString()}`, { cache: 'no-store', signal })
				);

				applySequencedEvents(payload.events);
				lastEventId = Math.max(lastEventId, payload.latestId);
				liveConnectionState = 'live';
				if (payload.events.length === 0) {
					await abortableDelay(300, signal);
				}
			} catch {
				if (signal.aborted) return;
				liveConnectionState = 'reconnecting';
				await abortableDelay(2000, signal);
			}
		}
	}

	function handleEvent(event: ConsoleEvent) {
		if (event.type === 'thread.started') { void loadThreads(); return; }
		if (event.type === 'context.updated') {
			rememberContextUsage(event.threadId, event.contextUsage);
			return;
		}
		if (event.type === 'approval.requested') {
			if (event.threadId === selectedThreadId) approvals = [...approvals.filter(a => a.requestId !== event.approval.requestId), event.approval];
			return;
		}
		if (event.type === 'approval.resolved') { approvals = approvals.filter(a => a.requestId !== event.requestId); return; }
		if (event.type === 'turn.completed') {
			rememberContextUsage(event.threadId, event.contextUsage);
			void loadThreads();
			completeLiveEntriesForTurn(event.threadId, event.turnId);
			if (runningTurnId === event.turnId) runningTurnId = null;
			if (event.threadId === selectedThreadId) { void loadThread(event.threadId, { silent: true }); }
			return;
		}
		if (event.type === 'turn.started') {
			rememberContextUsage(event.threadId, event.contextUsage);
			if (event.threadId === selectedThreadId) {
				replaceOptimisticTurnId(event.turnId);
				runningTurnId = event.turnId;
				errorClearedAt = 0;
			}
			return;
		}
		if (event.type === 'item.started') {
			queueLiveEntryUpdate(event.item.id, event.threadId, {
				...event.item,
				turnId: event.turnId,
				startedAt: event.item.startedAt ?? Date.now()
			});
			maybeFollowLiveOutput(event.threadId);
			return;
		}
		if (event.type === 'item.completed') {
			const items = event.items && event.items.length > 0 ? event.items : [event.item];
			if (event.sourceItemId) removeLiveEntry(event.threadId, event.sourceItemId);
			for (const item of items) {
				const current = getLiveEntry(event.threadId, item.id);
				const completedAt = item.completedAt ?? Date.now();
				const startedAt = item.startedAt ?? current?.startedAt ?? null;
				queueLiveEntryUpdate(item.id, event.threadId, {
					...item,
					turnId: event.turnId,
					startedAt,
					completedAt,
					durationMs: item.durationMs ?? (startedAt ? completedAt - startedAt : null)
				});
			}
			maybeFollowLiveOutput(event.threadId);
			return;
		}
		if (event.type === 'message.delta') { appendLiveEntryField(event.itemId, event.threadId, 'text', event.delta, { turnId: event.turnId }, { kind: 'assistant', label: 'Assistant' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'reasoning.delta') { appendLiveEntryField(event.itemId, event.threadId, 'text', event.delta, { turnId: event.turnId }, { kind: 'reasoning', label: 'Reasoning' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'command.delta') { appendLiveEntryField(event.itemId, event.threadId, 'output', event.delta, { ...event.item, turnId: event.turnId }, { kind: 'command', label: 'Command' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'file_change.delta') { appendLiveEntryField(event.itemId, event.threadId, 'text', event.delta, { turnId: event.turnId }, { kind: 'file_change', label: 'File change' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'error') {
			errorMessage = event.message;
			// Force-clear stuck turn state so the user can continue sending messages
			if (runningTurnId) {
				runningTurnId = null;
				errorClearedAt = Date.now();
				// Delay thread reload so reconcileRunningTurn doesn't immediately re-arm the lock
				const tid = selectedThreadId;
				if (tid) setTimeout(() => void loadThread(tid, { silent: true }), 3000);
			}
		}
	}

	// ── Effects ──
	$effect(() => {
		source?.close();
		source = null;
		eventPollController?.abort();
		eventPollController = null;
		if (!authenticated) return;

		if (shouldPollEvents()) {
			const controller = new AbortController();
			eventPollController = controller;
			void pollEvents(controller.signal);
			return () => {
				controller.abort();
				if (eventPollController === controller) eventPollController = null;
			};
		}

		let errorCount = 0;
		const next = new EventSource('/api/events');
		liveConnectionState = 'connecting';
		next.onopen = () => { liveConnectionState = 'live'; };
		next.onmessage = (raw) => {
			const id = Number(raw.lastEventId);
			if (Number.isFinite(id) && id > 0) lastEventId = Math.max(lastEventId, id);
			handleEvent(JSON.parse(raw.data) as ConsoleEvent);
		};
		next.onerror = () => {
			liveConnectionState = 'reconnecting';
			errorCount += 1;
			if (errorCount >= 3) {
				next.close();
				forceEventPolling = true;
			}
		};
		source = next;
		return () => { next.close(); if (source === next) source = null; };
	});

	$effect(() => {
		if (authenticated && selectedThreadId && selectedThread?.thread.id !== selectedThreadId) void loadThread(selectedThreadId);
	});

	$effect(() => {
		if (!authenticated || typeof window === 'undefined') return;
		let cancelled = false;
		let probeInFlight = false;
		const hasActiveTurn = runningTurnId !== null || Object.keys(liveEntries).length > 0;

		const probeThreadList = async () => {
			if (probeInFlight) return;
			probeInFlight = true;
			try {
				const payload = await readJson<ThreadListProbeResponse>(
					await fetch('/api/threads?view=probe', { cache: 'no-store' })
				);
				if (!cancelled && payload.signature !== threadListSignature) {
					await loadThreads();
				}
			} catch {
				// Keep probing quietly in the background.
			} finally {
				probeInFlight = false;
			}
		};

		// Increase interval during active turns (SSE stream handles live updates)
		const interval = hasActiveTurn ? THREAD_LIST_PROBE_INTERVAL_MS * 4 : THREAD_LIST_PROBE_INTERVAL_MS;

		const timer = window.setInterval(() => {
			if (document.hidden) return;
			void probeThreadList();
		}, interval);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	});

	$effect(() => {
		if (selectedThreadId) flushLiveBuffer(selectedThreadId);
	});

	$effect(() => {
		const threadId = selectedThreadId;
		if (!authenticated || !threadId || !interruptableTurnId) return;
		const timer = window.setInterval(() => {
			void loadThread(threadId, { silent: true });
		}, 5000);
		return () => window.clearInterval(timer);
	});

	$effect(() => {
		if (!authenticated || loadingThread || draftingThread) return;
		const id = selectedThread?.thread.id ?? data.selectedThread?.thread.id ?? null;
		if (!id || id === autoScrolledThreadId) return;
		autoScrolledThreadId = id;
		void tick().then(() => scrollMainTo('bottom'));
	});

	$effect(() => {
		if (!authenticated || !mainScroller || showingDraftThread) return;
		const target = scrollTarget();
		const handle = () => {
			if (Date.now() < scrollRestoreLockUntil) return;
			syncScrollState();
			if (historicalTurns.length > 0) syncActiveTurnIndex();
		};
		void tick().then(() => handle());
		target.addEventListener('scroll', handle, { passive: true });
		window.addEventListener('resize', handle);
		return () => { target.removeEventListener('scroll', handle); window.removeEventListener('resize', handle); };
	});

	$effect(() => {
		if (!authenticated) return;
		if (!allThreads.length) {
			if (selectedThread) return;
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			liveEntryBuffers = {};
			draftingThread = true;
			return;
		}
		if (selectedThreadId && !allThreads.some(t => t.id === selectedThreadId)) {
			if (selectedThread?.thread.id === selectedThreadId) {
				threads = mergeThreadSummaries(threads, selectedThread.thread);
				return;
			}
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			draftingThread = true;
		}
	});
</script>

{#snippet permissionIcon(mode: PermissionMode)}
	<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
		{#if mode === 'default'}
			<path d="M7.5 10.4V5.8a1.3 1.3 0 0 1 2.6 0v4" />
			<path d="M10.1 9.4V4.8a1.3 1.3 0 0 1 2.6 0v5" />
			<path d="M12.7 9.8V6.2a1.3 1.3 0 0 1 2.6 0v5.4c0 3-1.9 5.4-5 5.4H9.1a5 5 0 0 1-4.2-2.3l-2-3.1a1.25 1.25 0 0 1 2-1.5l1.3 1.4" />
		{:else if mode === 'auto'}
			<path d="M10 2.6 15.7 5v4.5c0 3.3-2.2 6.2-5.7 7.8-3.5-1.6-5.7-4.5-5.7-7.8V5L10 2.6z" />
			<path d="M7.4 10.1 9.1 11.8 12.8 8" />
		{:else}
			<path d="M10 2.6 15.7 5v4.5c0 3.3-2.2 6.2-5.7 7.8-3.5-1.6-5.7-4.5-5.7-7.8V5L10 2.6z" />
			<path d="M10 6.4v4.3" />
			<path d="M10 13.6h.01" />
		{/if}
	</svg>
{/snippet}

{#snippet permissionPicker()}
	<div class="permission-picker" class:open={permissionMenuOpen}>
		<button
			type="button"
			class:full={permissionMode === 'full'}
			class="permission-trigger"
			aria-haspopup="menu"
			aria-controls="permission-menu"
			aria-expanded={permissionMenuOpen}
			onclick={(event) => { event.stopPropagation(); permissionMenuOpen = !permissionMenuOpen; modelMenuOpen = false; contextMenuOpen = false; }}
		>
			<span class="permission-trigger-icon">{@render permissionIcon(selectedPermission.mode)}</span>
			<span>{selectedPermission.label}</span>
			<svg class="permission-chevron" viewBox="0 0 20 20" aria-hidden="true">
				<path d="M6 8 10 12 14 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
		{#if permissionMenuOpen}
			<div class="permission-menu" id="permission-menu" role="menu" tabindex="-1">
				{#each permissionOptions as option}
					<button
						type="button"
						class:selected={permissionMode === option.mode}
						class:full={option.mode === 'full'}
						class="permission-option"
						role="menuitemradio"
						aria-checked={permissionMode === option.mode}
						onclick={() => selectPermissionMode(option.mode)}
					>
						<span class="permission-option-icon">{@render permissionIcon(option.mode)}</span>
						<span class="permission-option-copy">
							<span>{option.label}</span>
							<small>{option.description}</small>
						</span>
						{#if permissionMode === option.mode}
							<svg class="permission-check" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet speedIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
		<path d="M10.8 1.9 3.2 11.1c-.35.42-.05 1.06.5 1.06h4.08l-1.12 5.34c-.15.72.76 1.14 1.2.56l7.14-9.38c.32-.42.02-1.02-.51-1.02h-3.86l1.28-5.17c.17-.7-.65-1.15-1.11-.6Z" />
	</svg>
{/snippet}

{#snippet contextIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true" fill="none">
		<path d="M4.5 5.5h11M4.5 10h11M4.5 14.5h6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
	</svg>
{/snippet}

{#snippet contextMeter()}
	<div
		class="context-meter"
		class:open={contextMenuOpen}
	>
		<button
			type="button"
			class="context-trigger"
			aria-haspopup="dialog"
			aria-expanded={contextMenuOpen}
			aria-label="背景信息窗口"
			title="背景信息窗口"
			onclick={(event) => { event.stopPropagation(); contextMenuOpen = !contextMenuOpen; modelMenuOpen = false; permissionMenuOpen = false; }}
		>
			<span class="context-trigger-icon">{@render contextIcon()}</span>
			<span class="context-trigger-copy">
				<span>{contextUsagePercent(currentContextUsage)}</span>
			</span>
		</button>
		{#if contextMenuOpen}
			<div class="context-popover" role="dialog" tabindex="-1" aria-label="背景信息窗口">
				<div class="context-popover-header">
					<span>背景信息窗口</span>
					<strong>{contextUsagePercent(currentContextUsage)}</strong>
				</div>
				<div class="context-progress" aria-hidden="true">
					<span style={`width: ${contextFillWidth}%`}></span>
				</div>
				<p>{contextUsageSummary(currentContextUsage)}</p>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet modelPicker()}
	<div class="model-picker" class:open={modelMenuOpen}>
		<button
			type="button"
			class="model-trigger"
			aria-haspopup="menu"
			aria-controls="model-menu"
			aria-expanded={modelMenuOpen}
			onclick={(event) => { event.stopPropagation(); modelMenuOpen = !modelMenuOpen; permissionMenuOpen = false; contextMenuOpen = false; }}
		>
			{#if serviceTier === 'fast'}
				<span class="model-trigger-icon">{@render speedIcon()}</span>
			{/if}
			<span class="model-trigger-copy">
				<span>{modelShortName(selectedModel)}</span>
				<small>{selectedReasoningLabel}</small>
			</span>
			<svg class="model-chevron" viewBox="0 0 20 20" aria-hidden="true">
				<path d="M6 8 10 12 14 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
		{#if modelMenuOpen}
			<div
				class="model-menu"
				id="model-menu"
				role="menu"
				tabindex="-1"
				onclick={(event) => event.stopPropagation()}
				onkeydown={(event) => { if (event.key === 'Escape') modelMenuOpen = false; }}
			>
				<div class="model-menu-label">智能</div>
				<div class="model-choice-list">
					{#each reasoningOptions as option}
						<button
							type="button"
							class="model-option compact"
							class:selected={reasoningEffort === option.effort}
							disabled={!selectedModel.supportedReasoningEfforts.includes(option.effort)}
							role="menuitemradio"
							aria-checked={reasoningEffort === option.effort}
							onclick={() => selectReasoningEffort(option.effort)}
						>
							<span>{option.label}</span>
							{#if reasoningEffort === option.effort}
								<svg class="model-check" viewBox="0 0 20 20" aria-hidden="true">
									<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							{/if}
						</button>
					{/each}
				</div>
				<div class="model-menu-divider"></div>
				<button
					type="button"
					class="model-option submenu"
					aria-expanded={modelListOpen}
					onclick={() => { modelListOpen = !modelListOpen; speedListOpen = false; }}
				>
					<span>{selectedModel.displayName}</span>
					<svg class="model-submenu-chevron" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M8 5.5 12.5 10 8 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				{#if modelListOpen}
					<div class="model-sublist">
						{#each availableModels as model (model.id)}
							<button
								type="button"
								class="model-option nested"
								class:selected={selectedModel.id === model.id}
								onclick={() => selectModel(model)}
							>
								<span class="model-option-copy">
									<span>{model.displayName}</span>
									{#if model.provider}<span class='model-trigger-provider'>{model.provider}</span>{/if}
									<small>{model.description}</small>
								</span>
								{#if selectedModel.id === model.id}
									<svg class="model-check" viewBox="0 0 20 20" aria-hidden="true">
										<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								{/if}
							</button>
						{/each}
					</div>
					<div class="custom-model-row">
						<input type="text" class="custom-model-input" bind:value={customModelInput} placeholder="Custom model..." />
						<button class="custom-model-add" disabled={!customModelInput.trim()} onclick={() => { addCustomModel(); }}>Add</button>
					</div>
					<div class="custom-model-row">
						<input type="text" class="custom-model-input" bind:value={customProviderUrl} placeholder="Provider URL (e.g. http://127.0.0.1:9090)" />
						<button class="custom-model-add" disabled={!customProviderUrl.trim()} onclick={() => { localStorage.setItem('customProviderUrl', customProviderUrl); void loadModels(); }}>Fetch</button>
					</div>
				{/if}
				<button
					type="button"
					class="model-option submenu"
					aria-expanded={speedListOpen}
					onclick={() => { speedListOpen = !speedListOpen; modelListOpen = false; }}
				>
					{#if serviceTier === 'fast'}
						<span class="model-option-icon">{@render speedIcon()}</span>
					{/if}
					<span>速度</span>
					<svg class="model-submenu-chevron" viewBox="0 0 20 20" aria-hidden="true">
						<path d="M8 5.5 12.5 10 8 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				{#if speedListOpen}
					<div class="model-sublist">
						<button
							type="button"
							class="model-option nested"
							class:selected={serviceTier === null}
							onclick={() => selectServiceTier(null)}
						>
							<span>标准</span>
							{#if serviceTier === null}
								<svg class="model-check" viewBox="0 0 20 20" aria-hidden="true">
									<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							{/if}
						</button>
						<button
							type="button"
							class="model-option nested"
							class:selected={serviceTier === 'fast'}
							disabled={!supportsFastTier}
							onclick={() => selectServiceTier('fast')}
						>
							<span class="model-option-icon">{@render speedIcon()}</span>
							<span>速度优先</span>
							{#if serviceTier === 'fast'}
								<svg class="model-check" viewBox="0 0 20 20" aria-hidden="true">
									<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							{/if}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet sendIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<path d="M10 16V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		<path d="M5.5 8.5 10 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
{/snippet}

{#snippet stopIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<rect x="6.5" y="6.5" width="7" height="7" rx="1.2" fill="currentColor" />
	</svg>
{/snippet}

{#snippet imageIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<rect x="2" y="3" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
		<circle cx="7" cy="8" r="1.5" fill="currentColor" />
		<path d="M2 14l4-4 3 3 2-2 7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
	</svg>
{/snippet}

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<svelte:window
onclick={(event) => {
	permissionMenuOpen = false;
	modelMenuOpen = false;
	contextMenuOpen = false;
	modelListOpen = false;
	speedListOpen = false;
	if (!codexSidebarPinned && !codexSidebarPanel?.contains(event.target as Node)) {
		codexSidebarOpen = false;
	}
}}
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			permissionMenuOpen = false;
			modelMenuOpen = false;
			contextMenuOpen = false;
			modelListOpen = false;
			speedListOpen = false;
			if (!codexSidebarPinned) codexSidebarOpen = false;
			closeThreadManagerDialog();
		}
	}}
/>

{#if !authenticated}
	<LoginView
		tokenConfigured={data.tokenConfigured}
		setupMode={data.setupMode}
		fallbackTokenActive={data.fallbackTokenActive}
		loginError={form?.loginError}
		setupError={form?.setupError}
	/>
{:else}
	<div class:sidebar-collapsed={sidebarCollapsed} class="app-shell">
		{#if !sidebarCollapsed}
			<button
				type="button"
				class="mobile-sidebar-backdrop"
				onclick={() => { sidebarCollapsed = true; }}
				aria-label="Close sidebar"
				title="Close sidebar"
			></button>
		{/if}

		<!-- Sidebar -->
		<aside class="sidebar">
			<div class="sidebar-header">
				<div>
					<h1>Codex</h1>
					<small>Web Console</small>
				</div>
				<div class="sidebar-actions">
					<button onclick={cycleTheme} title="Toggle theme" aria-label="Toggle theme">
						<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							{#if currentTheme === 'dark'}
								<path d="M17 12.7A7 7 0 1 1 7.3 3a7 7 0 0 0 9.7 9.7z" />
							{:else}
								<circle cx="10" cy="10" r="4" />
								<path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M15.2 4.8l1.4-1.4M3.4 16.6l1.4-1.4" />
							{/if}
						</svg>
					</button>
					<form method="POST" action="?/logout" use:enhance={enhanceRedirect} class="logout-form">
						<button aria-label="Log out" title="Log out">
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M8 3.5H5.75A2.25 2.25 0 0 0 3.5 5.75v8.5A2.25 2.25 0 0 0 5.75 16.5H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M11 6.25 15 10l-4 3.75M15 10H7.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						</button>
					</form>
					<button
						onclick={() => { sidebarCollapsed = true; }}
						aria-label="Collapse sidebar" title="Collapse sidebar"
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d="M7 4v12M13 7l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
				</div>
			</div>

			<button style="width:100%;justify-content:center" onclick={startDraftThread}>
				New thread
			</button>

			<select bind:value={providerFilter} style="font-size:12px">
				{#each providerOptions as provider}
					<option value={provider}>{provider === 'all' ? 'All providers' : provider}</option>
				{/each}
			</select>

			<ThreadList
				threads={visibleThreads}
				selectedThreadId={draftingThread ? null : visibleSelectedThreadId}
				onSelect={(id) => void openThread(id)}
				onManage={openThreadManager}
			/>

			<div class="status-bar">
				<span class="live-dot {liveConnectionState}" style="flex:0 0 auto"></span>
				<span style="flex:1">{liveConnectionState === 'live' ? 'Connected' : liveConnectionState === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
			</div>
		</aside>

		<main bind:this={mainScroller} class="main">
			<div class="thread-workspace">
				<!-- Header -->
				<div class="detail-header">
					<div>
						<h2 class="detail-title">
							{showingDraftThread ? 'New thread' : (selectedSummary?.title ?? 'Nothing selected')}
						</h2>
						{#if !showingDraftThread && selectedSummary}
							<p class="detail-cwd">{selectedSummary.cwd}</p>
						{/if}
					</div>
				</div>

				<!-- Body -->
				{#if showingDraftThread}
					<div class="compose-view">
						<div class="compose-panel">
							{#if liveConnectionWarning}
								<p class="warning live-warning">{liveConnectionWarning}</p>
							{/if}
							{#if visibleErrorMessage}
								<p class="error">{visibleErrorMessage}</p>
							{/if}
							<section class="workspace-picker" aria-label="Workspace">
								<div class="workspace-picker-header">
									<div>
										<span class="compose-field-label">Workspace</span>
										<p>{workspacePath || visibleWorkspacePath}</p>
									</div>
									<button class="ghost workspace-browse" type="button" onclick={() => void openBrowser(workspacePath || visibleWorkspacePath)}>
										Browse
									</button>
								</div>

								{#if workspaceOptions.length > 0}
									<div class="workspace-option-list">
										{#each workspaceOptions.slice(0, 6) as option (option.key)}
											<button
												type="button"
												class="workspace-option"
												class:selected={isSelectedWorkspace(option.path)}
												onclick={() => selectWorkspace(option.path)}
											>
												<span class="workspace-option-icon" aria-hidden="true">
													<svg viewBox="0 0 20 20">
														<path d="M3.5 6.25A2.25 2.25 0 0 1 5.75 4h2.1c.55 0 .9.2 1.25.62l.8.96c.22.27.42.37.78.37h3.57a2.25 2.25 0 0 1 2.25 2.25v5.05a2.25 2.25 0 0 1-2.25 2.25h-8.5a2.25 2.25 0 0 1-2.25-2.25v-7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
													</svg>
												</span>
												<span class="workspace-option-copy">
													<strong>{option.name}</strong>
													<small>{option.meta}{option.count > 1 ? ` · ${option.count} threads` : ''}</small>
												</span>
												<span class="workspace-option-path" title={option.path}>{workspaceParent(option.path)}</span>
											</button>
										{/each}
									</div>
								{/if}

								<label class="workspace-custom">
									<span>Custom path</span>
									<input bind:value={workspacePath} spellcheck="false" placeholder={String(data.homePath)} />
								</label>
							</section>
							<div class="prompt-composer">
								{#if pendingImages.length > 0}
									<div class="image-preview-strip">
										{#each pendingImages as img, i}
											<div class="image-preview-item">
												<img src={img} alt="附件 {i + 1}" />
												<button type="button" class="image-preview-remove" onclick={() => removeImage(i, 'new')} aria-label="移除图片">×</button>
											</div>
										{/each}
									</div>
								{/if}
								<textarea
									class="prompt-input"
									bind:value={newPrompt}
									rows="4"
									placeholder="要求后续变更（可粘贴或拖入图片）"
									onkeydown={(e) => submitOnEnter(e, () => void createThread())}
									onpaste={(e) => handleImagePaste(e, 'new')}
									ondrop={(e) => handleImageDrop(e, 'new')}
									ondragover={(e) => { e.preventDefault(); }}
								></textarea>
								<div class="prompt-toolbar">
									<div class="prompt-toolbar-left" class:menu-open={modelMenuOpen || permissionMenuOpen || contextMenuOpen}>
										{@render modelPicker()}
										{@render contextMeter()}
										{@render permissionPicker()}
										<button
											type="button"
											class="toolbar-btn"
											onclick={() => newImageInput?.click()}
											title="添加图片"
											aria-label="添加图片"
										>
											{@render imageIcon()}
										</button>
										<input
											type="file"
											accept="image/*"
											multiple
											bind:this={newImageInput}
											onchange={(e) => { if (newImageInput?.files) addImages(newImageInput.files, 'new'); newImageInput && (newImageInput.value = ''); }}
											hidden
										/>
									</div>
									<button
										class="composer-send"
										type="button"
										onclick={() => void createThread()}
										disabled={submitting || !(workspacePath || visibleWorkspacePath).trim() || !hasComposerContent(newPrompt, pendingImages)}
										aria-label={submitting ? 'Starting thread' : 'Start thread'}
										title={submitting ? 'Starting thread' : 'Start thread'}
									>
										{@render sendIcon()}
									</button>
								</div>
							</div>
						</div>
					</div>
				{:else if loadingThread}
					<div class="detail-body">
						<p class="empty">Loading thread…</p>
					</div>
				{:else}
					<div class="detail-body">
						<div class="detail-body-inner">
							<Timeline
								turns={historicalTurns}
								liveEntries={visibleLiveEntryList}
								{approvals}
								cwd={visibleSelectedThread?.thread.cwd ?? ''}
								omittedTurnCount={visibleSelectedThread?.omittedTurnCount ?? 0}
								onResolveApproval={(requestId, decision) =>
									void resolveApproval(requestId, decision)}
								onLoadFullHistory={() => {
									if (visibleSelectedThreadId) void loadThread(visibleSelectedThreadId, { silent: true, full: true });
								}}
							/>
						</div>
					</div>
				{/if}

				<!-- Reply -->
				{#if !showingDraftThread && visibleSelectedThread}
					<div class="reply-box" bind:this={mobileComposerElement}>
						{#if liveConnectionWarning}
							<p class="warning live-warning">{liveConnectionWarning}</p>
						{/if}
						{#if visibleErrorMessage}
							<p class="error">{visibleErrorMessage}</p>
						{/if}
						<div class="prompt-composer">
							{#if replyImages.length > 0}
								<div class="image-preview-strip">
									{#each replyImages as img, i}
										<div class="image-preview-item">
											<img src={img} alt="附件 {i + 1}" />
											<button type="button" class="image-preview-remove" onclick={() => removeImage(i, 'reply')} aria-label="移除图片">×</button>
										</div>
									{/each}
								</div>
							{/if}
							<textarea
								class="prompt-input"
								bind:value={replyPrompt}
								rows="3"
								placeholder="要求后续变更（可粘贴或拖入图片）"
								disabled={Boolean(interruptableTurnId) || interrupting}
								onkeydown={(e) => submitOnEnter(e, () => void sendReply())}
								onpaste={(e) => handleImagePaste(e, 'reply')}
								ondrop={(e) => handleImageDrop(e, 'reply')}
								ondragover={(e) => { e.preventDefault(); }}
							></textarea>
							<div class="prompt-toolbar">
								<div class="prompt-toolbar-left" class:menu-open={modelMenuOpen || permissionMenuOpen || contextMenuOpen}>
									{@render modelPicker()}
									{@render contextMeter()}
									{@render permissionPicker()}
									<button
										type="button"
										class="toolbar-btn"
										onclick={() => replyImageInput?.click()}
										title="添加图片"
										aria-label="添加图片"
										disabled={Boolean(interruptableTurnId) || interrupting}
									>
										{@render imageIcon()}
									</button>
									<input
										type="file"
										accept="image/*"
										multiple
										bind:this={replyImageInput}
										onchange={(e) => { if (replyImageInput?.files) addImages(replyImageInput.files, 'reply'); replyImageInput && (replyImageInput.value = ''); }}
										hidden
									/>
								</div>
								<div class="prompt-toolbar-right">
									{#if interruptableTurnId}
										<button
											class="composer-send composer-stop"
											type="button"
											onclick={() => void interruptCurrentTurn()}
											disabled={interrupting}
											aria-label={interrupting ? 'Stopping current turn' : 'Stop current turn'}
											title={interrupting ? 'Stopping current turn' : 'Stop current turn'}
										>
											{@render stopIcon()}
										</button>
									{:else}
										<button
											class="composer-send"
											type="button"
											onclick={() => void sendReply()}
											disabled={submitting || interrupting || !hasComposerContent(replyPrompt, replyImages)}
											aria-label={submitting ? 'Sending message' : 'Send message'}
											title={submitting ? 'Sending message' : 'Send message'}
										>
											{@render sendIcon()}
										</button>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</main>
	</div>

	{#if !showingDraftThread && visibleSelectedThread && hasProgressItems}
		<button
			type="button"
			class="codex-sidebar-tab"
			class:visible={!codexSidebarVisible}
			onclick={(event) => {
				event.stopPropagation();
				codexSidebarOpen = true;
			}}
			aria-label="打开进度侧栏"
			title="打开进度侧栏"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M8 7.5h10M8 12h10M8 16.5h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
				<path d="M4.8 7.5h.01M4.8 12h.01M4.8 16.5h.01" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />
			</svg>
		</button>

		<aside
			bind:this={codexSidebarPanel}
			class="codex-sidebar-panel"
			class:visible={codexSidebarVisible}
			class:pinned={codexSidebarPinned}
			aria-label="Codex 进度侧栏"
		>
			<div class="codex-sidebar-card">
				<header class="codex-sidebar-header">
					<div>
						<p>Codex</p>
						<h3>进度</h3>
					</div>
					<div class="codex-sidebar-actions">
						<button
							type="button"
							class="codex-sidebar-icon"
							class:active={codexSidebarPinned}
							onclick={toggleCodexSidebarPinned}
							aria-label={codexSidebarPinned ? '取消固定侧栏' : '固定侧栏'}
							title={codexSidebarPinned ? '取消固定侧栏' : '固定侧栏'}
						>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M7.25 3.5h5.5l-.8 4.15 2.55 2.35v1.1H5.5V10l2.55-2.35-.8-4.15Z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round" />
								<path d="M10 11.1v5.4" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" />
							</svg>
						</button>
						<button
							type="button"
							class="codex-sidebar-icon"
							onclick={() => {
								codexSidebarOpen = false;
								codexSidebarPinned = false;
							}}
							aria-label="关闭进度侧栏"
							title="关闭进度侧栏"
						>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
							</svg>
						</button>
					</div>
				</header>

				<div class="codex-progress-summary">
					<span class="codex-progress-kicker">
						{`${progressSummary.done}/${progressSummary.total} 已完成`}
					</span>
					<span class="codex-progress-state" class:active={progressSummary.active}>
						{progressSummary.active ? '同步中' : '已同步'}
					</span>
				</div>
				<ol class="codex-progress-list">
					{#each progressItems as item (item.id)}
						<li class={`codex-progress-item is-${item.status}`}>
							<span class="codex-progress-marker" aria-hidden="true">
								{#if item.status === 'done'}
									<svg viewBox="0 0 20 20">
										<path d="M5 10.2 8.4 13.5 15 6.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								{/if}
							</span>
							<span class="codex-progress-copy">
								<span>{item.text}</span>
								<small>{progressStatusLabel(item.status)}</small>
							</span>
						</li>
					{/each}
				</ol>
			</div>
		</aside>
	{/if}

	{#if sidebarCollapsed}
		<button
			type="button"
			class="sidebar-reopen"
			onclick={() => { sidebarCollapsed = false; }}
			aria-label="Expand sidebar" title="Expand sidebar"
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M7 4v12M10 7l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
	{/if}

	{#if !browserOpen && !showingDraftThread && showScrollToBottom}
		<div class="screen-tools" role="group" aria-label="Page controls">
			<button type="button" class="floating-button jump-bottom" aria-label="Scroll to bottom" title="Scroll to bottom" onclick={() => scrollMainTo('bottom')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="M10 4v12M5.5 11.5 10 16l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</div>
	{/if}

	<WorkspaceBrowser
		open={browserOpen}
		{listing}
		selectedPath={workspacePath}
		onClose={() => { browserOpen = false; }}
		onNavigate={(p) => void openBrowser(p)}
		onSelect={(p) => { workspacePath = p; browserOpen = false; }}
	/>

	{#if threadManagerDialog}
		{@const managedThread = threadManagerDialog.thread}
		<div
			class="thread-manager-layer"
			role="presentation"
			onclick={(event) => {
				if (event.target === event.currentTarget && !threadMutationPending) {
					closeThreadManagerDialog();
				}
			}}
		>
			<div
				class={`thread-manager-popover is-${threadManagerDialog.mode}`}
				style={`left:${threadManagerDialog.x}px;top:${threadManagerDialog.y}px;`}
				role="dialog"
				tabindex="-1"
				aria-modal="true"
				aria-labelledby="thread-manager-title"
				onmousedown={(event) => event.stopPropagation()}
			>
				<div class="thread-manager-header">
					<div>
						<h3 id="thread-manager-title">
							{threadManagerDialog.mode === 'menu'
								? '管理'
								: threadManagerDialog.mode === 'rename'
									? '重命名'
									: '删除对话'}
						</h3>
						{#if threadManagerDialog.mode !== 'menu'}
							<p>{managedThread.title}</p>
						{/if}
					</div>
					<button
						type="button"
						class="thread-manager-close"
						aria-label="关闭"
						onclick={() => closeThreadManagerDialog()}
						disabled={threadMutationPending}
					>
						×
					</button>
				</div>

				{#if threadManagerDialog.mode === 'menu'}
					<div class="thread-manager-menu">
						<button
							type="button"
							class="thread-manager-option"
							onclick={() => beginRenameThread(managedThread)}
						>
							<span>重命名</span>
						</button>
						<button
							type="button"
							class="thread-manager-option is-danger"
							onclick={() => beginDeleteThread(managedThread)}
						>
							<span>删除</span>
						</button>
					</div>
				{:else if threadManagerDialog.mode === 'rename'}
					<label class="thread-manager-field">
						<span>对话名称</span>
						<input
							bind:value={threadNameDraft}
							maxlength="120"
							placeholder="输入新的对话名称"
							disabled={threadMutationPending}
							onkeydown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									void submitThreadRename();
								}
							}}
						/>
					</label>
				{:else}
					<p class="thread-manager-warning">
						删除后该对话会从列表中移除。
					</p>
				{/if}

				{#if threadManagerDialog.mode !== 'menu'}
					<div class="thread-manager-actions">
						<button type="button" class="ghost" onclick={() => closeThreadManagerDialog()} disabled={threadMutationPending}>
							取消
						</button>
						{#if threadManagerDialog.mode === 'rename'}
							<button type="button" onclick={() => void submitThreadRename()} disabled={threadMutationPending || !threadNameDraft.trim()}>
								{threadMutationPending ? '保存中…' : '保存'}
							</button>
						{:else if threadManagerDialog.mode === 'delete'}
							<button type="button" class="danger-button" onclick={() => void submitThreadDelete()} disabled={threadMutationPending}>
								{threadMutationPending ? '删除中…' : '确认删除'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
