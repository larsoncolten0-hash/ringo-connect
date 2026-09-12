// Ringo Card Writer — the browser-side NFC engine behind the customer-
// facing "Write Your Ringo Card" feature (see
// src/components/dashboard/RingoCardWriter.tsx). This file is the ONLY
// place that talks to the raw Web NFC API (NDEFReader) — every technical
// term (NDEF, tag, read/write) is meant to stay in here and in code
// comments; the UI layer speaks only in Ringo Card language.
//
// Client-only by construction: every export either checks
// `typeof window === "undefined"` up front or is only ever called from a
// "use client" component's event handler, so nothing here can run during
// server-side rendering (NDEFReader doesn't exist on the server, and
// referencing it there would throw).
//
// Web NFC (chrome.com/web-nfc) is currently Chrome-on-Android only —
// there is no Safari/iOS or desktop-browser support as of this writing.
// We never claim otherwise; isSupported() is the single source of truth
// the UI checks before offering to write.

// ---------------------------------------------------------------------------
// Minimal ambient Web NFC types — not part of TypeScript's DOM lib, so we
// declare just enough of the spec's shape to use it safely. Kept narrow on
// purpose: only the members this file actually touches.
// ---------------------------------------------------------------------------
interface NDEFRecordInit {
  recordType: string;
  data?: string;
  mediaType?: string;
}

interface NDEFWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NDEFReadOptions {
  signal?: AbortSignal;
}

interface NDEFRecord {
  recordType: string;
  mediaType?: string | null;
  data?: DataView;
}

interface NDEFMessage {
  records: NDEFRecord[];
}

interface NDEFReadingEvent extends Event {
  serialNumber: string;
  message: NDEFMessage;
}

interface NDEFReader extends EventTarget {
  write(message: { records: NDEFRecordInit[] }, options?: NDEFWriteOptions): Promise<void>;
  scan(options?: NDEFReadOptions): Promise<void>;
  onreading: ((this: NDEFReader, ev: NDEFReadingEvent) => void) | null;
  onreadingerror: ((this: NDEFReader, ev: Event) => void) | null;
}

declare global {
  interface Window {
    NDEFReader?: { new (): NDEFReader };
  }
}

// ---------------------------------------------------------------------------
// Support detection
// ---------------------------------------------------------------------------

// True only on a browser that actually exposes the Web NFC constructor —
// today, Chrome for Android with NFC hardware. This is the single check
// the whole feature gates on; nothing about the physical Ringo Card
// changes, only whether THIS browser/device can write or read it.
export function isWebNfcSupported(): boolean {
  return typeof window !== "undefined" && typeof window.NDEFReader === "function";
}

// Web NFC requires a secure context (HTTPS, or localhost in dev) — a
// distinct failure mode from "unsupported browser" worth telling apart in
// diagnostics, even though the UI's top-level message is the same either
// way ("not supported on this device or browser").
export function isSecureContextAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

// A quick, best-effort "is this even worth trying" signal for the UI
// (roughly: Android). Never used to make a hard promise about iPhone
// support — isWebNfcSupported() above is what actually gates the feature;
// this only informs the "open this on a compatible Android phone" hint.
export function isLikelyAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

// True on iPhone/iPad in any browser (Safari, or Chrome/Edge-on-iOS,
// which are required by Apple to run on WebKit under the hood). Used only
// to tailor the "not supported" copy — no iOS browser implements Web
// NFC's write API at all, so this is a real, permanent platform gap
// rather than a bug to retry around. Reading a finished Ringo Card still
// works fine on iPhone via iOS's own background NFC tag reading — this
// only affects a creator trying to WRITE a card from their iPhone.
export function isLikelyIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // Modern iPadOS reports as "MacIntel" with touch support, hence the
  // extra maxTouchPoints check alongside the classic UA sniff.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// ---------------------------------------------------------------------------
// Error taxonomy — every failure the UI needs to tell apart, mapped from
// whatever DOMException/error the browser actually throws. The UI never
// shows a raw browser error message to the creator; it looks up polished
// copy per code (see RingoCardWriter.tsx / translations.ts's ringoCard
// section).
// ---------------------------------------------------------------------------
export type RingoCardErrorCode =
  | "unsupported"
  | "insecure_context"
  | "permission_denied"
  | "not_detected"
  | "read_only"
  | "invalid_state"
  | "aborted"
  | "network_error"
  | "timeout"
  | "unknown";

export class RingoCardError extends Error {
  code: RingoCardErrorCode;
  cause_?: unknown;
  constructor(code: RingoCardErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "RingoCardError";
    this.code = code;
    this.cause_ = cause;
  }
}

function mapNativeError(err: unknown): RingoCardError {
  if (err instanceof RingoCardError) return err;
  const name = err instanceof DOMException ? err.name : (err as any)?.name;
  switch (name) {
    case "NotAllowedError":
      // Covers both "user/browser denied NFC permission" and "not a
      // secure context" — Chrome throws the same DOMException name for
      // both, so we can't fully tell them apart post-hoc; the UI checks
      // isSecureContextAvailable() up front to catch the latter earlier.
      return new RingoCardError("permission_denied", "NFC permission was denied.", err);
    case "NotSupportedError":
      return new RingoCardError("unsupported", "Web NFC is not supported here.", err);
    case "NotReadableError":
      return new RingoCardError("not_detected", "No Ringo Card was detected.", err);
    case "InvalidStateError":
      return new RingoCardError("invalid_state", "The NFC reader is in an invalid state.", err);
    case "NetworkError":
      // Chrome's actual name for "tag was removed / connection lost
      // mid-operation" — not a network problem despite the name.
      return new RingoCardError("network_error", "The Ringo Card was moved away before finishing.", err);
    case "AbortError":
      return new RingoCardError("aborted", "The operation was cancelled.", err);
    default:
      return new RingoCardError("unknown", (err as any)?.message || "Something went wrong.", err);
  }
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

// Writes a single NDEF URL record containing ONLY the Ringo profile URL —
// never the profile's data, never any token or credential. The physical
// card is deliberately "dumb": it just points back at Ringo, so editing a
// profile later never requires touching the card again.
//
// Resolves once an actual physical tag has been found and successfully
// written; rejects with a RingoCardError otherwise. Callers are
// responsible for not invoking this again while a previous call is still
// pending (see RingoCardWriter.tsx's `busy` guard) — Web NFC has no
// built-in "already writing" protection of its own.
export async function writeRingoCardUrl(url: string, signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined") throw new RingoCardError("unsupported", "Ringo Card Writer requires a browser.");
  if (!isWebNfcSupported()) throw new RingoCardError("unsupported", "Web NFC is not available in this browser.");
  if (!isSecureContextAvailable()) throw new RingoCardError("insecure_context", "A secure (HTTPS) connection is required.");

  const reader = new window.NDEFReader!();
  try {
    await reader.write({ records: [{ recordType: "url", data: url }] }, { signal });
  } catch (err) {
    throw mapNativeError(err);
  }
}

export interface RingoCardReadResult {
  // The URL found on the card, if its first record decodes as one.
  url: string | null;
  // The chip's hardware serial number, where the browser exposes it —
  // metadata only, see the migration's comment on ringo_cards.card_uid.
  serialNumber: string | null;
}

// One-shot read used by both "Verify" (right after writing) and
// "Read Card" (diagnostics). Resolves with whatever was found on the
// first tag detected, or rejects with a RingoCardError — including a
// "timeout" if no tag is presented within `timeoutMs`.
export async function readRingoCard(timeoutMs = 15000): Promise<RingoCardReadResult> {
  if (typeof window === "undefined") throw new RingoCardError("unsupported", "Ringo Card Writer requires a browser.");
  if (!isWebNfcSupported()) throw new RingoCardError("unsupported", "Web NFC is not available in this browser.");
  if (!isSecureContextAvailable()) throw new RingoCardError("insecure_context", "A secure (HTTPS) connection is required.");

  const reader = new window.NDEFReader!();
  const controller = new AbortController();

  return new Promise<RingoCardReadResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new RingoCardError("timeout", "No Ringo Card was detected in time."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      reader.onreading = null;
      reader.onreadingerror = null;
    };

    reader.onreading = (event: NDEFReadingEvent) => {
      cleanup();
      controller.abort(); // stop scanning — we only need the first tap
      const record = event.message.records.find((r) => r.recordType === "url");
      let url: string | null = null;
      if (record?.data) {
        try {
          url = new TextDecoder().decode(record.data);
        } catch {
          url = null;
        }
      }
      resolve({ url, serialNumber: event.serialNumber || null });
    };

    reader.onreadingerror = () => {
      cleanup();
      reject(new RingoCardError("not_detected", "Couldn't read the Ringo Card."));
    };

    reader.scan({ signal: controller.signal }).catch((err) => {
      cleanup();
      reject(mapNativeError(err));
    });
  });
}
