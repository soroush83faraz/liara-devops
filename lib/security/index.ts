/**
 * Server-only security primitives (uses node:crypto / node:fs). Never import from
 * client components; import types from lib/contracts instead.
 */
export * from "./canonical";
export * from "./redact";
export * from "./injection";
export {
  APPROVAL_TOKEN_DEFAULT_TTL_MS,
  APPROVAL_TOKEN_MAX_TTL_MS,
  ApprovalTokenError,
  ApprovalKeyConfigError,
  getApprovalKey,
  mintApprovalToken,
  inspectApprovalToken,
  verifyApprovalToken,
  consumeNonce,
  type ApprovalTokenFailureReason,
  type ApprovalClaims,
  type MintApprovalTokenInput,
  type MintedApprovalToken,
  type VerifiedApprovalToken,
  type TokenKeyOptions,
} from "./tokens";
export * from "./state-machine";
export * from "./policy";
export * from "./store";
export * from "./audit";
export { cleanText, foldForMatch, hasInvisibleControls } from "./unicode";
