"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Driver } from "@/lib/data";
import { getDriverImage } from "@/lib/data";

interface DragOverlayContentProps {
  driver: Driver;
}

export function DragOverlayContent({ driver }: DragOverlayContentProps) {
  return (
    <div className="flex items-center gap-2 bg-card border rounded-lg px-3 py-2 shadow-xl pointer-events-none">
      <Avatar className="w-10 h-10 border-2 border-primary">
        <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait" />
        <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
      </Avatar>
      <span className="font-bold text-sm">{driver.name}</span>
    </div>
  );
}
