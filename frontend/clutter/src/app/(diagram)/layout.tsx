import "@xyflow/react/dist/style.css";
import type { ReactNode } from "react";

export default function DiagramLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden text-foreground">
      <div className="cloud-shell h-full w-full bg-background">
        {children}
      </div>
    </div>
  );
}
