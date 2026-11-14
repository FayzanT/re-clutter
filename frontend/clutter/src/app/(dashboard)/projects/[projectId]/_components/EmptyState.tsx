"use client";

import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="w-full flex justify-center">
      <div
        className="
          w-full max-w-4xl 
          text-center 
          py-24 
          mt-12
          rounded-2xl
          border border-dashed border-border
          bg-card
        "
      >
        <div className="text-5xl mb-6">{icon}</div>
        <h2 className="text-2xl font-semibold text-foreground mb-3">{title}</h2>
        <p className="text-muted-foreground mb-8">{description}</p>
        
        {actionLabel && onAction && (
          <Button
            onClick={onAction}
            className="bg-card border border-border hover:border-primary/50 text-foreground px-5 py-4 rounded-lg"
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}