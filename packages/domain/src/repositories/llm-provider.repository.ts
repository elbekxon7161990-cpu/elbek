/**
 * DI token for @afa/infrastructure's implementation. No concrete provider
 * is bound to this token yet — TASK-INFRA-010 defines the port and its
 * resilience decorators only; the first real binding (an actual LLM vendor)
 * belongs to TASK-AI-002, which is the first task that actually needs to
 * extract structured data from a real model.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** A single turn in the conversation sent to the model — text only (FR-SYS-004: understanding, never multimodal here). */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * TASK-INFRA-010 (FR-SYS-006, FR-INT-001) — the minimum provider-neutral
 * request shape TASK-AI-001/002 need. Every field here is grounded in a
 * specific PRD requirement, not speculated:
 * - `systemInstructions`/`messages` — text input, system vs. user
 *   instructions (Chapter 4 §4.5's prompt structure).
 * - `model` — model selection (§3.16.3's per-provider timeout/cost
 *   allocation, §4.18 model routing).
 * - `temperature` — deterministic, grounded extraction (AI-P3/AI-P7)
 *   needs a low/fixed temperature; optional since a given call may accept
 *   the provider's default.
 * - `maxOutputTokens` — bounds cost/latency (NFR-AI-009, §3.16.3's timeout
 *   budget).
 * - `responseSchema` — TASK-AI-001's own reason for existing is
 *   "Structured Output Schema Validation"; the adapter must be able to
 *   request schema/JSON-constrained output from the provider. Left as
 *   `unknown` here deliberately — the concrete schema shape is TASK-AI-001's
 *   own concern (Chapter 4 §4.9), not this port's.
 *
 * Deliberately excluded (no current requirement justifies them): tool/
 * function calling (AI-P8 — "one consolidated call", not an agentic call
 * chain), multimodal/image/document input (OCR/STT are separate adapters
 * per §3.16.1's table, not this port).
 */
export interface LlmCompletionRequest {
  systemInstructions?: string;
  messages: LlmMessage[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: unknown;
}

export type LlmFinishReason = 'stop' | 'length' | 'content_filter' | 'error';

/**
 * The raw completion only — this port never parses/validates
 * `content` against `responseSchema` itself. That's TASK-AI-001's own
 * "zero-tolerance schema validation" responsibility (NFR-AI-003); blurring
 * it into this port would duplicate that task's reason for existing.
 */
export interface LlmCompletionResult {
  content: string;
  finishReason: LlmFinishReason;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Port (Chapter 3 §3.16.1 Shared Adapter Pattern, FR-SYS-006/FR-INT-001) —
 * "every component that calls an External Provider... does so through an
 * internal adapter interface, never a direct SDK call embedded in business
 * logic". Implemented by packages/infrastructure; @afa/application depends
 * only on this interface, never on a vendor SDK.
 */
export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
