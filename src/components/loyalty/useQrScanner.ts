"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Camera QR scanning for the Loyalty "Scan Customer" screen.
//
//  * The camera is requested ONLY when start() is called from a button tap: never on page
//    load, so opening Loyalty never triggers a permission prompt.
//  * Stops itself after the first successful decode (the customer card takes over) and
//    releases the camera; it also releases it on unmount.
//  * Reuses the jsqr package already in the project. It does not touch, import or change the
//    event-gate scanner (EventScannerView) or the service worker.

export type ScannerState = "idle" | "starting" | "scanning" | "denied" | "no_camera" | "unsupported" | "insecure";

const DECODE_INTERVAL_MS = 120;
const MAX_DECODE_WIDTH = 640;

export function useQrScanner(onCode: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDecodeRef = useRef(0);
  const runningRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<ScannerState>("idle");

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const tick = useCallback(() => {
    if (!runningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const now = Date.now();
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && now - lastDecodeRef.current > DECODE_INTERVAL_MS) {
      lastDecodeRef.current = now;
      const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
      const w = Math.max(1, Math.floor(video.videoWidth * scale));
      const h = Math.max(1, Math.floor(video.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const image = ctx.getImageData(0, 0, w, h);
        const code = jsQR(image.data, w, h, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          stop();
          setState("idle");
          onCodeRef.current(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  const start = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) return setState("insecure");
    if (!navigator.mediaDevices?.getUserMedia) return setState("unsupported");

    stop();
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        return setState("idle");
      }
      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setState("scanning");
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      stop();
      const name = err?.name as string | undefined;
      if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") setState("no_camera");
      else setState("unsupported");
    }
  }, [stop, tick]);

  const cancel = useCallback(() => {
    stop();
    setState("idle");
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { videoRef, canvasRef, state, start, stop: cancel };
}
