"use client";

import { useDroppable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Driver } from "@/lib/data";
import { getDriverImage } from "@/lib/data";
import { cn } from "@/lib/utils";
import { DraggableDriver } from "./DraggableDriver";

interface DroppablePoolZoneProps {
  availableDrivers: Driver[];
  isLocked: boolean;
  onAddDriver: (driver: Driver) => void;
}

export function DroppablePoolZone({
  availableDrivers,
  isLocked,
  onAddDriver,
}: DroppablePoolZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id: "pool-zone" });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-all rounded-lg",
        isOver && "ring-2 ring-green-400 shadow-[0_0_12px_rgba(74,222,128,0.3)]"
      )}
    >
      <ScrollArea className="h-72">
        <div className="grid grid-cols-2 gap-2 pr-4">
          {availableDrivers.map((driver) => (
            <DraggableDriver
              key={driver.id}
              id={`pool-${driver.id}`}
              disabled={isLocked}
            >
              <Button
                variant="secondary"
                className="h-auto p-2 flex items-center gap-2 justify-start w-full"
                onClick={() => onAddDriver(driver)}
              >
                <Avatar className="w-8 h-8">
                  <AvatarImage
                    src={getDriverImage(driver.id)}
                    data-ai-hint="driver portrait"
                  />
                  <AvatarFallback>{driver.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{driver.name}</span>
              </Button>
            </DraggableDriver>
          ))}
        </div>
        <ScrollBar className="bg-muted" />
      </ScrollArea>
    </div>
  );
}
