// A lightweight phone bezel — same visual idea as the dashboard's own
// live-preview frame (LivePreviewPanel.tsx), kept separate so the
// marketing page never imports dashboard-internal code. A slight resting
// perspective tilt (common in premium product shots — Apple, Stripe) so
// it reads as a photographed object rather than a flat screenshot pasted
// on the page; straightens back to flat on hover/focus.
export default function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="transition-transform duration-500 ease-out [transform:perspective(1400px)_rotateY(-8deg)_rotateX(2deg)] hover:[transform:perspective(1400px)_rotateY(0deg)_rotateX(0deg)]"
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className="w-[280px] sm:w-[300px] shrink-0 rounded-[2.1rem] border-[8px] border-[#161616] bg-[#161616] shadow-[0_50px_100px_-30px_rgba(15,23,42,0.45)]">
        <div className="relative rounded-[1.5rem] overflow-hidden" style={{ height: 560 }}>
          <div className="absolute top-0 inset-x-0 h-5 flex items-center justify-center z-30 pointer-events-none">
            <div className="w-20 h-4 bg-[#161616] rounded-b-xl" />
          </div>
          <div className="no-scrollbar w-full h-full overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
