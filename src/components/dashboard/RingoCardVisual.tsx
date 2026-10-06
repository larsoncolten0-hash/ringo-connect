import RingoCard3D from "@/components/brand/RingoCard3D";

// The Ringo Card's UI illustration: the design foundation's own card object (RingoCard3D: a card with thickness, the Ring and the NFC mark
// floating in front of the face, a tilt toward a mouse, flat for touch and for reduced motion), in Ringo's indigo. While a card is being
// written it shows the waiting state (the Ring sweeps). A representation only, never a claim about the printed card's design (product brief
// section 39). The ID printed on it is a placeholder dash pattern: the illustration invents no identifier.
export default function RingoCardVisual({ pulsing = false, name = "Ringo" }: { pulsing?: boolean; name?: string }) {
  return (
    <div className="ringo-indigo-world py-6" aria-hidden="true">
      <RingoCard3D name={name} ringoId="----" state={pulsing ? "waiting" : "idle"} restTilt={{ x: 3, y: -6 }} emblem className="mx-auto max-w-[300px]" />
    </div>
  );
}
