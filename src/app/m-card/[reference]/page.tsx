"use client";

import { Nfc } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Where a Membership Card's physical NFC chip points — see
// member_card_url in 2026-09-18_association_program.sql. A Member has no
// public profile page to land on, so a stray real-world tap (anyone's
// phone auto-opening the URL, outside the Partner app entirely) needs
// somewhere safe to go instead. Deliberately minimal and non-sensitive: no
// Association name, no Member identity, nothing looked up server-side at
// all — just a static explanation of what this object is.
export default function MembershipCardLandingPage() {
  const { t } = useLanguage();
  const a = t.association;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-xs text-center flex flex-col items-center gap-3">
        <span className="w-14 h-14 rounded-full bg-ringo-indigo/10 flex items-center justify-center">
          <Nfc size={24} className="text-ringo-indigo" />
        </span>
        <p className="text-sm font-medium text-ringo-text">{a.membershipCardLandingTitle}</p>
        <p className="text-xs text-ringo-muted">{a.membershipCardLandingBody}</p>
      </div>
    </div>
  );
}
