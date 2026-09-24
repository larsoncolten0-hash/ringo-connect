// Central safety guard for Fapshi configuration. Pure and dependency-free: it decides whether the
// resolved configuration (mode, base URL, where the credentials came from, which deployment we are
// in) is a combination that can be trusted, and throws a fixed, secret-free error when it is not.
// It never sees or prints a credential — only where the credentials came from.
//
// Rules:
//  1. The base URL must match the mode (sandbox host <-> test mode, live host <-> live mode).
//  2. Live mode only runs in a production deployment. Vercel: VERCEL_ENV === "production";
//     elsewhere: NODE_ENV === "production". Local dev, previews and staging cannot reach live Fapshi.
//  3. Credentials stored in the database are chosen by mode (test set <-> test mode, live set <->
//     live mode), so they cannot be mismatched. Credentials from environment variables carry no
//     mode, so they must be declared with FAPSHI_ENV_CREDENTIALS_MODE=sandbox|live and the
//     declaration must equal the active mode. An undeclared env fallback is still accepted in live
//     mode inside production (that is how it behaved before this guard); it is refused in sandbox
//     mode because it cannot be proven to be sandbox credentials.
// Sandbox mode is allowed in every deployment, production included (an admin may test there).

export type FapshiCredentialSource = "database" | "environment" | "none";

export type FapshiSafetyEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  FAPSHI_ENV_CREDENTIALS_MODE?: string;
};

export type FapshiSafetyCode =
  | "fapshi_mode_url_mismatch"
  | "fapshi_live_outside_production"
  | "fapshi_env_credentials_mode_mismatch"
  | "fapshi_env_credentials_mode_undeclared";

export const SANDBOX_BASE_URL = "https://sandbox.fapshi.com";
export const LIVE_BASE_URL = "https://live.fapshi.com";

const MESSAGES: Record<FapshiSafetyCode, string> = {
  fapshi_mode_url_mismatch: "Fapshi configuration refused: the API host does not match the test/live mode.",
  fapshi_live_outside_production: "Fapshi configuration refused: live mode is only allowed in a production deployment.",
  fapshi_env_credentials_mode_mismatch: "Fapshi configuration refused: FAPSHI_ENV_CREDENTIALS_MODE does not match the active test/live mode.",
  fapshi_env_credentials_mode_undeclared: "Fapshi configuration refused: environment credentials in test mode must declare FAPSHI_ENV_CREDENTIALS_MODE=sandbox.",
};

export class FapshiConfigSafetyError extends Error {
  code: FapshiSafetyCode;
  constructor(code: FapshiSafetyCode) {
    super(MESSAGES[code]);
    this.name = "FapshiConfigSafetyError";
    this.code = code;
  }
}

export function isProductionDeployment(env: FapshiSafetyEnv): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

/** Returns the violated rule, or null when the configuration is safe. */
export function checkFapshiConfigSafety(input: {
  testMode: boolean;
  baseUrl: string;
  credentialSource: FapshiCredentialSource;
  env: FapshiSafetyEnv;
}): FapshiSafetyCode | null {
  const { testMode, baseUrl, credentialSource, env } = input;
  if (baseUrl !== (testMode ? SANDBOX_BASE_URL : LIVE_BASE_URL)) return "fapshi_mode_url_mismatch";
  if (!testMode && !isProductionDeployment(env)) return "fapshi_live_outside_production";
  if (credentialSource === "environment") {
    const declared = (env.FAPSHI_ENV_CREDENTIALS_MODE || "").trim().toLowerCase();
    const active = testMode ? "sandbox" : "live";
    if (declared) {
      if (declared !== active) return "fapshi_env_credentials_mode_mismatch";
    } else if (testMode) {
      return "fapshi_env_credentials_mode_undeclared";
    }
  }
  return null;
}

export function assertFapshiConfigSafe(input: Parameters<typeof checkFapshiConfigSafety>[0]): void {
  const code = checkFapshiConfigSafety(input);
  if (code) throw new FapshiConfigSafetyError(code);
}
