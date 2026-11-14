import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      <div className="space-y-8">
        <Skeleton className="h-12 w-64 bg-card" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 bg-card" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48 bg-card" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 bg-card" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
