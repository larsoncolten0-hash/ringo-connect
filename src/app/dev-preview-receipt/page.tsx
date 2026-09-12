"use client";

// TEMP — throwaway visual QA page for the redesigned payment receipt.
// Not linked from anywhere, not part of the real app. Delete this file
// (and the __previewStep/__previewReceipt props on UpgradeModal) once
// the screenshot is confirmed.

import UpgradeModal from "@/components/subscription/UpgradeModal";

export default function DevPreviewReceipt() {
  return (
    <div style={{ background: "#f5f5f4", minHeight: "100vh" }}>
      <UpgradeModal
        planName="pro"
        priceXaf={15000}
        priceUsd={25}
        priceXafYearly={150000}
        priceUsdYearly={250}
        defaultMethod="mobile_money"
        defaultInterval="monthly"
        onClose={() => {}}
        onSuccess={() => {}}
        __previewStep="mm-success"
        __previewReceipt={{
          transId: "TX2024090812345",
          amount: 15000,
          medium: "mobile money",
          date: new Date().toISOString(),
        }}
      />
    </div>
  );
}
