"use client";

import { Info } from "lucide-react";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { isWebNfcSupported } from "@/lib/ringoCardWriter";
import { useLanguage } from "@/components/LanguageProvider";

// "Card Details" — the one place technical NFC terminology (NDEF,
// NTAG216, card serial/UID) is allowed to appear, and even then framed as
// an optional, collapsed-by-default section so ordinary creators never
// have to read it (see product brief section 10). Reuses the app's
// existing Accordion rather than building a bespoke collapsible.
export default function RingoCardDiagnostics({
  cardReference,
  destinationUrl,
  cardUid,
  hasBeenWritten,
}: {
  cardReference: string;
  destinationUrl: string | null;
  cardUid: string | null;
  // Whether THIS card has a recorded successful write — the only
  // evidence we actually have for "writable," since Web NFC has no way
  // to probe a tag's lock state without attempting a real write.
  hasBeenWritten: boolean;
}) {
  const { t } = useLanguage();
  const d = t.ringoCard.diagnostics;
  const supported = isWebNfcSupported();

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-ringo-border/50 last:border-0">
      <span className="text-xs text-ringo-muted">{label}</span>
      <span className="text-xs font-medium text-ringo-text text-right break-all">{value}</span>
    </div>
  );

  return (
    <Accordion className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
      <AccordionItem id="diagnostics" icon={Info} title={t.ringoCard.cardDetailsToggle}>
        <div className="flex flex-col">
          <Row label={d.cardReference} value={cardReference} />
          <Row label={d.cardStatus} value={hasBeenWritten ? d.writable : d.notDetected} />
          <Row label={d.ndef} value={supported ? d.supported : d.notDetected} />
          <Row label={d.destination} value={destinationUrl || "—"} />
          <Row label={d.technology} value={d.technologyValue} />
          <Row label={d.memory} value={d.memoryUnknown} />
          {cardUid && <Row label={d.cardUid} value={cardUid} />}
        </div>
        {cardUid && <p className="text-[11px] text-ringo-muted mt-2">{d.cardUidHint}</p>}
      </AccordionItem>
    </Accordion>
  );
}
