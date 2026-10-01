import ReceivablesTabs from "@/components/receivables/ReceivablesTabs";

// Debtors area (/dashboard/documents/receivables/**), inside the invoice area: the parent layout already requires the entitled owner.
export default function ReceivablesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ReceivablesTabs />
      {children}
    </div>
  );
}
