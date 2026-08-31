import type { TransactionSourceType } from '../entities/transaction.entity';
import type { TransactionExtractionCandidate } from '../ai-extraction/transaction-extraction-schema';

export const TRANSACTION_COMMIT_PORT = Symbol('TRANSACTION_COMMIT_PORT');

export interface TransactionCommitRequest {
  userId: string;
  candidate: TransactionExtractionCandidate;
  /**
   * TASK-FIN-REAL-001 — the same `draftId` `CandidateResolvedEvent` (TASK-BOT-002)
   * carries, stable for one logical AI-resolved message. The real adapter
   * uses this as an idempotency key (BR-CE-006-style "the same logical
   * commit produces exactly one transaction") — never a new value invented
   * per attempt, so a genuine retry against the same originating message
   * is recognized as the same commit, not a second one.
   */
  draftId: string;
  /** Chapter 4 §4.8's traceability requirement ("every AI-derived financial record must be traceable back to its raw source input") — `NewTransactionData.originalText` needs this; extraction candidates alone never carried it before TASK-FIN-REAL-001. */
  originalText: string;
  /** `NewTransactionData.sourceType` — which input modality produced `originalText` (`'text'`/`'voice'`/`'photo'`/etc.), supplied by whichever Bot Application Layer routing use case originated this request. */
  sourceType: TransactionSourceType;
}

export interface TransactionCommitResult {
  transactionId: string;
}

/**
 * TASK-BOT-002's "hand off to the Domain Service Layer" boundary
 * (§5.12.2's component diagram: `TE -->|resolved, high/medium conf.| DS`).
 *
 * A real implementation (TASK-FIN-REAL-001, `@afa/application`'s
 * `TransactionCommitAdapter`) now exists, resolving the category-code gap
 * this port's own history originally deferred: `CategoryRepository.findByCode`
 * (added by that same task) resolves `candidate.category`'s stable code
 * into the UUID `CreateExpenseUseCase`/`CreateIncomeUseCase` require, and
 * the adapter reuses those two use cases unchanged for all persistence,
 * validation, and domain-invariant enforcement — this port itself still
 * only describes the boundary, never the persistence mechanism.
 */
export interface TransactionCommitPort {
  commit(request: TransactionCommitRequest): Promise<TransactionCommitResult>;
}
