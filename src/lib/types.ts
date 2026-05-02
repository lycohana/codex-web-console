export type EntryKind =
	| 'user'
	| 'assistant'
	| 'reasoning'
	| 'web_search'
	| 'tool_call'
	| 'command'
	| 'file_change'
	| 'plan'
	| 'system';

export type PermissionMode = 'default' | 'auto' | 'full';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ServiceTier = 'fast' | 'flex';

export interface ModelOption {
	id: string;
	model: string;
	displayName: string;
	description: string;
	hidden: boolean;
	supportedReasoningEfforts: ReasoningEffort[];
	defaultReasoningEffort: ReasoningEffort;
	additionalSpeedTiers: string[];
	isDefault: boolean;
	provider?: string | null;
}

export interface ModelSelection {
	model?: string | null;
	effort?: ReasoningEffort | null;
	serviceTier?: ServiceTier | null;
	provider?: string | null;
}

export interface ThreadSummary {
	id: string;
	title: string;
	preview: string;
	cwd: string;
	updatedAt: number | null;
	status: string;
	provider: string | null;
}

export interface TimelineEntry {
	id: string;
	turnId?: string;
	kind: EntryKind;
	label: string;
	text?: string;
	phase?: 'commentary' | 'final_answer' | null;
	command?: string;
	cwd?: string;
	output?: string;
	query?: string;
	url?: string;
	pattern?: string;
	actionType?: string | null;
	queries?: string[];
	toolName?: string;
	serverName?: string;
	toolInput?: string;
	toolOutput?: string;
	exitCode?: number | null;
	status?: string | null;
	startedAt?: number | null;
	completedAt?: number | null;
	durationMs?: number | null;
	changes?: Array<{
		path: string;
		kind: string;
		diff: string;
	}>;
	images?: string[];
}

export interface TimelineTurn {
	id: string;
	status: string;
	errorMessage?: string | null;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
	entries: TimelineEntry[];
}

export interface ApprovalRequest {
	requestId: string;
	threadId: string;
	turnId: string;
	method: string;
	title: string;
	reason: string | null;
	command: string | null;
	cwd: string | null;
	grantRoot: string | null;
	requestedAt: number;
}

export interface ThreadDetail {
	thread: ThreadSummary;
	turns: TimelineTurn[];
	approvals: ApprovalRequest[];
	omittedTurnCount?: number;
}

export interface DirectoryListing {
	path: string;
	parentPath: string | null;
	entries: Array<{
		name: string;
		path: string;
		isDirectory: boolean;
		isFile: boolean;
	}>;
}

export type ConsoleEvent =
	| {
			type: 'thread.started';
			thread: ThreadSummary;
	  }
	| {
			type: 'turn.started' | 'turn.completed';
			threadId: string;
			turnId: string;
	  }
	| {
			type: 'item.started' | 'item.completed';
			threadId: string;
			turnId: string;
			item: TimelineEntry;
	  }
	| {
			type: 'message.delta' | 'reasoning.delta' | 'command.delta' | 'file_change.delta';
			threadId: string;
			turnId: string;
			itemId: string;
			delta: string;
			item?: Partial<TimelineEntry>;
	  }
	| {
			type: 'approval.requested';
			threadId: string;
			approval: ApprovalRequest;
	  }
	| {
			type: 'approval.resolved';
			threadId: string;
			requestId: string;
	  }
	| {
			type: 'error';
			message: string;
	  };
