"use client";

// Opens the browser's print dialog for the shared document page (print styles hide the buttons). The only client script on the public page.
export default function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-900 print:hidden">
      {label}
    </button>
  );
}
