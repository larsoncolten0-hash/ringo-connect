"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  CameraOff,
  DoorOpen,
  LogOut,
} from "lucide-react";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import ScannerAddToHomeScreen from "./ScannerAddToHomeScreen";
import ScannerSoundToggle from "./ScannerSoundToggle";
import { useSound } from "@/components/SoundProvider";

// Maps the scan API's outcome strings down to the three sounds the gate
// scanner actually distinguishes by ear: a bright positive chime for a
// valid ticket, a flat double-beep for one already used, and a single low
// tone for everything else that isn't a valid entry (not found, wrong
// event, unpaid, cancelled, refunded, session/network trouble). A guard is
// watching the screen color and icon anyway — the sound just confirms it
// without them having to read anything, including in low light or with a
// glove-thick tap that delays looking down.
function scanOutcomeSound(outcome: string): "scanValid" | "scanInvalid" | "scanAlreadyUsed" {
  if (outcome === "approved") return "scanValid";
  if (outcome === "already_used" || outcome === "already_inside") return "scanAlreadyUsed";
  return "scanInvalid";
}

type SessionInfo = {
  eventTitle: string;
  gateName: string;
  scannerType: "entry" | "exit";
  permissionLevel: "scanner" | "supervisor";
  checkedInCount: number;
};

type ScanResult = {
  outcome: string;
  ticketTypeName: string | null;
  holderName: string | null;
  ticketCode: string | null;
  idRequired?: boolean;
};

// How long a result stays on screen before the camera resumes scanning —
// deliberately no manual "confirm"/"next" button anywhere in this
// component (see section 22 of the spec this was built from): the guard
// never touches the screen for a normal ticket, valid or not. A rejection
// gets a little longer so the reason is actually readable.
const RESULT_HOLD_MS = { approved: 1400, other: 2400 } as const;
// Ignore the exact same decoded code for this long after handling it, so
// a QR still sitting in frame when scanning resumes doesn't immediately
// re-fire the same scan a second time.
const SAME_CODE_COOLDOWN_MS = 4000;

// The full-screen, continuous-scanning "Ringo Event Scanner" — see the
// route file's own comment for why this never touches anything but its
// own scanner-session token. Deliberately built on jsQR (a small,
// dependency-free decoder) plus a hand-rolled getUserMedia/canvas loop
// rather than a heavier all-in-one scanning library: this keeps full
// control over exactly when the camera reinitializes (only once, ever,
// per page load) versus when a scan is simply paused/resumed, which is
// the actual performance requirement for continuous concert-gate scanning.
export default function EventScannerView({ token }: { token: string }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "session-error" | "camera-error">("loading");
  const [sessionError, setSessionError] = useState<"not_found" | "revoked" | "expired" | "network">("network");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraPermission, setCameraPermission] = useState<"prompt" | "granted" | "denied">("prompt");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const streamRef = useRef<MediaStream | null>(null);
  // Refs, not state, for anything read inside the scan loop — this loop
  // runs on every animation frame while idle, and re-subscribing it to
  // fresh state on every render is exactly the kind of overhead
  // continuous scanning can't afford.
  const lockedRef = useRef(false);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const lastDecodeAttemptRef = useRef(0);
  const { play } = useSound();

  // Session info — fetched once on mount, not on every scan (the scan
  // route itself re-validates the token every single time, so a session
  // revoked mid-event still stops working on its next scan even though
  // this fetch never runs again).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scanner/${token}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSessionError(data.error === "revoked" ? "revoked" : data.error === "expired" ? "expired" : "not_found");
          setPhase("session-error");
          return;
        }
        setSession(data);
        setCheckedInCount(data.checkedInCount || 0);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setSessionError("network");
          setPhase("session-error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const submitScan = useCallback(
    async (code: string) => {
      lockedRef.current = true;
      let outcome = "network_error";
      try {
        const res = await fetch(`/api/scanner/${token}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket_code: code }),
        });
        const data: ScanResult = await res.json();
        outcome = data.outcome;
        setResult(data);
        play(scanOutcomeSound(data.outcome));
        if (data.outcome === "approved") setCheckedInCount((c) => c + 1);
      } catch {
        setResult({ outcome: "network_error", ticketTypeName: null, holderName: null, ticketCode: null });
        play("scanInvalid");
      }

      const holdMs = outcome === "approved" ? RESULT_HOLD_MS.approved : RESULT_HOLD_MS.other;
      setTimeout(() => {
        setResult(null);
        lockedRef.current = false;
      }, holdMs);
    },
    [token, play]
  );

  // The scan loop — one requestAnimationFrame chain for the page's whole
  // lifetime. Decoding continues to run even while a result is showing
  // (harmless — `lockedRef` just skips acting on it) so resuming after a
  // result never needs to reinitialize anything.
  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    // Decoding every animation-frame callback (~60/sec) is unnecessary for
    // a human pointing a phone at a QR code and wastes battery/CPU over
    // what can be hours of continuous use at a gate — ~8 attempts/sec is
    // still well under any perceptible delay for scanning, so throttle
    // the actual jsQR decode (not the frame loop itself, which keeps the
    // video smooth) to that rate.
    const now = Date.now();
    const shouldDecode = now - lastDecodeAttemptRef.current > 120;
    if (shouldDecode && video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      lastDecodeAttemptRef.current = now;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if (code?.data && !lockedRef.current) {
          const last = lastCodeRef.current;
          if (!last || last.code !== code.data || now - last.at > SAME_CODE_COOLDOWN_MS) {
            lastCodeRef.current = { code: code.data, at: now };
            submitScan(code.data);
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [submitScan]);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraPermission("granted");
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setCameraPermission("denied");
          setPhase("camera-error");
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // A blocked scanner (session revoked/expired, camera denied) stops the
  // guard's whole job cold, unlike an individual invalid ticket — an
  // "important error" by the sound spec's own definition, so it gets the
  // distinct error tone once, the moment the screen actually blocks them.
  useEffect(() => {
    if (phase === "session-error" || phase === "camera-error") play("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "loading") {
    return (
      <FullScreen>
        <Loader2 size={28} className="animate-spin text-white/70" />
      </FullScreen>
    );
  }

  if (phase === "session-error") {
    const messages: Record<typeof sessionError, string> = {
      not_found: "This scanner link isn't valid.",
      revoked: "This scanner has been deactivated by the organizer.",
      expired: "This scanner session has expired.",
      network: "Couldn't connect — check your internet connection and reload.",
    };
    return (
      <FullScreen>
        <ShieldAlert size={40} className="text-white/70 mb-3" />
        <p className="text-white text-center text-base font-medium px-6">{messages[sessionError]}</p>
      </FullScreen>
    );
  }

  if (phase === "camera-error") {
    return (
      <FullScreen>
        <CameraOff size={40} className="text-white/70 mb-3" />
        <p className="text-white text-center text-base font-medium px-6 mb-2">
          {cameraPermission === "denied" ? "Camera access was denied." : "Camera unavailable."}
        </p>
        <p className="text-white/60 text-center text-sm px-8">
          Ringo needs camera access to scan event tickets. Enable it in your browser's site settings for this page, then reload.
        </p>
      </FullScreen>
    );
  }

  const DirectionIcon = session?.scannerType === "exit" ? LogOut : DoorOpen;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <RegisterServiceWorker />
      <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Header — event + gate identity, plus two small icons: a sound
          mute toggle (ScannerSoundToggle.tsx — a guard has no access to
          the dashboard's own sound preference) and "Add to Home Screen"
          (ScannerAddToHomeScreen.tsx) so a guard who closes this by
          mistake can reopen exactly this gate's scanner — the only
          additions to "nothing else" in this header, since both keep the
          guard from having to hunt down the link again or fumble for a
          system volume control mid-event. */}
      <div className="absolute top-0 inset-x-0 p-4 pt-[calc(env(safe-area-inset-top)+1rem)] bg-gradient-to-b from-black/80 to-transparent">
        {session && (
          <div className="absolute top-3 right-3 flex items-center gap-2" style={{ marginTop: "env(safe-area-inset-top)" }}>
            <ScannerSoundToggle />
            <ScannerAddToHomeScreen gateName={session.gateName} />
          </div>
        )}
        <p className="text-white/60 text-[11px] font-semibold uppercase tracking-wider text-center">Ringo Connect</p>
        <p className="text-white text-sm font-bold text-center truncate mt-0.5">{session?.eventTitle}</p>
        <p className="text-white/80 text-xs font-medium text-center flex items-center justify-center gap-1.5 mt-0.5">
          <DirectionIcon size={12} />
          {session?.gateName}
        </p>
      </div>

      {/* Scan target — purely visual, jsQR reads the whole frame regardless. */}
      {!result && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-64 rounded-3xl border-4 border-white/50" />
          <p className="absolute bottom-[30%] text-white/70 text-sm font-medium">Point camera at ticket QR code</p>
        </div>
      )}

      {result && <ScanResultOverlay result={result} />}

      {/* Local tally — this gate only, see the API route's own comment. */}
      <div className="absolute bottom-0 inset-x-0 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] bg-gradient-to-t from-black/80 to-transparent">
        <p className="text-white/60 text-xs font-medium text-center uppercase tracking-wider">Checked In</p>
        <p className="text-white text-2xl font-bold text-center tabular-nums">{checkedInCount}</p>
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 bg-black flex flex-col items-center justify-center">{children}</div>;
}

const OUTCOME_DISPLAY: Record<string, { bg: string; Icon: any; title: string }> = {
  approved: { bg: "#16A34A", Icon: CheckCircle2, title: "VALID TICKET" },
  not_found: { bg: "#DC2626", Icon: XCircle, title: "INVALID TICKET" },
  wrong_event: { bg: "#DC2626", Icon: XCircle, title: "INVALID TICKET" },
  unpaid: { bg: "#DC2626", Icon: XCircle, title: "INVALID TICKET" },
  cancelled: { bg: "#DC2626", Icon: XCircle, title: "CANCELLED TICKET" },
  refunded: { bg: "#DC2626", Icon: XCircle, title: "REFUNDED TICKET" },
  already_used: { bg: "#EA580C", Icon: AlertTriangle, title: "TICKET ALREADY USED" },
  already_inside: { bg: "#EA580C", Icon: AlertTriangle, title: "ALREADY INSIDE" },
  not_inside: { bg: "#EA580C", Icon: AlertTriangle, title: "NOT CURRENTLY INSIDE" },
  expired_session: { bg: "#EA580C", Icon: AlertTriangle, title: "SCANNER SESSION EXPIRED" },
  network_error: { bg: "#EA580C", Icon: AlertTriangle, title: "NETWORK ERROR" },
};

function ScanResultOverlay({ result }: { result: ScanResult }) {
  const meta = OUTCOME_DISPLAY[result.outcome] || OUTCOME_DISPLAY.not_found;
  const { Icon } = meta;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: meta.bg }}>
      <Icon size={72} className="text-white mb-4" strokeWidth={2.2} />
      <p className="text-white text-2xl font-extrabold tracking-tight">{meta.title}</p>

      {result.outcome === "approved" && (
        <>
          {result.ticketTypeName && <p className="text-white/90 text-lg font-semibold mt-3">{result.ticketTypeName}</p>}
          {result.holderName && <p className="text-white text-base mt-1">{result.holderName}</p>}
          {result.idRequired && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-white bg-black/25 px-3 py-1.5 rounded-full">
              ⚠ ID VERIFICATION REQUIRED
            </p>
          )}
          <p className="text-white/85 text-sm font-semibold mt-4 uppercase tracking-wider">Entry Approved</p>
        </>
      )}

      {(result.outcome === "already_used" || result.outcome === "already_inside") && result.holderName && (
        <>
          <p className="text-white text-base mt-3">{result.holderName}</p>
          {result.ticketTypeName && <p className="text-white/80 text-sm mt-0.5">{result.ticketTypeName}</p>}
        </>
      )}

      {result.outcome === "not_found" && <p className="text-white/85 text-sm mt-3 max-w-xs">This ticket could not be verified.</p>}
      {(result.outcome === "wrong_event" || result.outcome === "unpaid") && (
        <p className="text-white/85 text-sm mt-3 max-w-xs">Do not allow entry.</p>
      )}
    </div>
  );
}
