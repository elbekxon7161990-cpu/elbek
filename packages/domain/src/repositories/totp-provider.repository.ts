export const TOTP_PROVIDER = Symbol('TOTP_PROVIDER');

export interface GeneratedTotpSecret {
  /** Raw TOTP seed — never persisted directly; callers must pass it through SECRET_STORE. */
  secret: string;
  /** `otpauth://` URI for authenticator-app enrollment (QR code / manual entry). */
  otpauthUrl: string;
}

/**
 * TASK-AUTH-002 (FR-AUTH-008) — TOTP (RFC 6238) baseline. RFC 6238's own
 * standard defaults (6 digits, 30-second period, HMAC-SHA1) are used since
 * the PRD cites the RFC as the baseline without further parameterizing it;
 * this is the RFC's own default, not an invented parameter.
 */
export interface TotpProviderPort {
  generateSecret(accountLabel: string): GeneratedTotpSecret;
  verify(secret: string, code: string): Promise<boolean>;
}
