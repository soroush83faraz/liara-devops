// Constants shared by playwright.config.ts and the specs (no Playwright imports so the config can load it cheaply).
import { tmpdir } from "node:os";
import { join } from "node:path";

export const APP_PORT = 3200;
export const LIARA_PORT = 4010;
export const AUTH_STATE = join(tmpdir(), "hamyar-e2e-auth-state.json");
export const E2E_DATA_DIR = join(tmpdir(), `hamyar-e2e-data-${APP_PORT}`);
export const E2E_SESSION_KEY = "e2e-session-key-0123456789-abcdefghijklmnopqrstuvwxyz-ZYXW";
export const E2E_APPROVAL_KEY = "e2e-approval-key-9876543210-zyxwvutsrqponmlkjihgfedcba-WXYZ";
