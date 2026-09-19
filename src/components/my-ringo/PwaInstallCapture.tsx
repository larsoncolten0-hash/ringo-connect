"use client";

import "./useInstallPrompt";

// Renders nothing: mounting this in the My Ringo layout just guarantees
// useInstallPrompt's module (and its early `beforeinstallprompt` listener)
// is loaded on every My Ringo page, before any card that uses it mounts.
export default function PwaInstallCapture() {
  return null;
}
