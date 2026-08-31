export interface AdminMfaVerifyInput {
  challengeToken: string;
  code: string;
  ipAddress: string | null;
}
