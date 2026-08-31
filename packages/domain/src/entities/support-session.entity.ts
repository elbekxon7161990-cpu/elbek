/**
 * TASK-SEC-006 — mirrors the `support_sessions` table. `Requested`/`Justified`
 * (§11.7.2) are collapsed into creation itself (see the schema's own doc
 * comment for why). `closedAt` (agent-ended) and `expiredAt` (worker-swept
 * timeout) are distinct so the audit trail can tell the two apart.
 */
export class SupportSession {
  constructor(
    public readonly id: string,
    public readonly agentAdminId: string,
    public readonly targetUserId: string,
    public readonly justification: string,
    public readonly createdAt: Date,
    public readonly expiresAt: Date,
    public readonly closedAt: Date | null,
    public readonly expiredAt: Date | null,
  ) {}
}
