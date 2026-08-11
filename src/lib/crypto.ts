import crypto from "crypto";

// Encrypts/decrypts secret values (API keys) before they touch the
// database. The encryption key (SETTINGS_ENCRYPTION_KEY) lives only in
// the server's environment — never in the database — so a database leak
// on its own can't decrypt anything stored here; you'd also need the
// deployment's env vars.
//
// scryptSync derives a proper 32-byte key from whatever passphrase is
// set as SETTINGS_ENCRYPTION_KEY, so it doesn't need to be an exact-length
// hex/base64 string — any reasonably long random string works.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey(): Buffer {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!passphrase) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY is not set — required to encrypt/decrypt platform settings. Generate one with: openssl rand -base64 32"
    );
  }
  return crypto.scryptSync(passphrase, "ringo-connect-settings-salt", 32);
}

/** Encrypts a plaintext secret. Returns a single string safe to store in a text column. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv + authTag + ciphertext together, base64-encoded.
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/** Decrypts a value produced by encryptSecret. Returns null if input is null/empty (nothing stored yet). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const key = getKey();
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}