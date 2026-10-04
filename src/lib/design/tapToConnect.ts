// Tap to Connect: the one interaction Ringo is about, as a tiny state machine that any surface can show (the Ringo
// Card, a "waiting for payment" screen, a connect button). This is presentation state only: it never talks to NFC
// hardware, a payment provider or the network. Whatever really happens is reported INTO it ("tap", "confirm", "reset").
//
//   idle       the Ring is open, ready for a tap
//   waiting    a tap or a request is in flight: the Ring sweeps
//   connected  it happened: the Ring closes and turns to signal
export type ConnectState = "idle" | "waiting" | "connected";
export type ConnectEvent = "tap" | "confirm" | "reset";

export const CONNECT_STATES: readonly ConnectState[] = ["idle", "waiting", "connected"];

export function nextConnectState(state: ConnectState, event: ConnectEvent): ConnectState {
  switch (event) {
    case "tap":
      return state === "idle" ? "waiting" : state;
    case "confirm":
      return state === "waiting" ? "connected" : state;
    case "reset":
      return "idle";
    default:
      return state;
  }
}

/** Which semantic color a state wears: gold while open or in flight (identity, attention), signal once connected (live). */
export function connectTone(state: ConnectState): "gold" | "signal" {
  return state === "connected" ? "signal" : "gold";
}
