import { Skeleton, SkeletonCircle, SkeletonRow } from "@/components/ui/Skeleton";

// Shown inside the My Ringo shell while a page's server data loads.
// `.loading-reveal` holds it invisible for ~160ms so fast navigations never
// flash a skeleton.
export default function MyRingoLoading() {
  return (
    <div className="loading-reveal flex flex-col gap-6" role="status" aria-busy="true">
      <div className="flex items-center gap-4 rounded-3xl border border-ringo-border/60 bg-ringo-surface p-5">
        <SkeletonCircle className="h-16 w-16 shrink-0" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-ringo-border/60 bg-ringo-surface">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}
