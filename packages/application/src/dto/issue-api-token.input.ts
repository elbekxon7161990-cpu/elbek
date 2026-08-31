export interface IssueApiTokenInput {
  clientIdentifier: string;
  scope: string[];
  /** Defaults to API_TOKEN_DEFAULT_RATE_LIMIT_PER_MINUTE (60) when omitted. */
  rateLimitPerMinute?: number;
}
