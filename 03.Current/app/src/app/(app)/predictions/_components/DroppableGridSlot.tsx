"use client";

import { useDroppable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Driver } from "@/lib/data";
import { getDriverImage } from "@/lib/data";
import { DraggableDriver } from "./DraggableDriver";

interface DroppableGridSlotProps {
  index: number;
  driver: Driver | null;
  isLocked: boolean;
  isRightLane: boolean;
  onMove: (index: number, direction: "up" | "down") => void;
  onRemove: (index: number) => void;
}

export function DroppableGridSlot({
  index,
  driver,
  isLocked,
  isRightLane,
  onMove,
  onRemove,
}: DroppableGridSlotProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `slot-${index}` });

  const highlightClass = isOver
    ? driver
      ? "ring-2 ring-amber-400 bg-amber-400/10"
      : "ring-2 ring-green-400 bg-green-400/10"
    : "";

  const slotContent = (
    <div
      ref={setNodeRef}
      className={cn(
        "relative group flex flex-col items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed bg-card-foreground/5 transition-colors h-[140px]",
        isRightLane && "translate-y-6",
        highlightClass
      )}
    >
      <div className="absolute top-1 left-2 font-bold text-muted-foreground text-sm">
        P{index + 1}
      </div>
      {!isLocked && driver && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onMove(index, "up")}
            disabled={index === 0}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onMove(index, "down")}
            disabled={index === 5}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
        </div>
      )}
      {driver ? (
        <>
          {!isLocked && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onRemove(index)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Avatar className="w-16 h-16 border-4 border-primary">
            <AvatarImage
              src={getDriverImage(driver.id)}
              data-ai-hint="driver portrait"
            />
            <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="text-center">
            <p className="font-bold text-sm">{driver.name}</p>
            <p className="text-xs text-muted-foreground">{driver.team}</p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
          <p className="text-xs">Select driver</p>
        </div>
      )}
    </div>
  );

  // Wrap filled slots in DraggableDriver so they can be dragged out
  if (driver && !isLocked) {
    return (
      <DraggableDriver id={`slot-${index}`}>
        {slotContent}
      </DraggableDriver>
    );
  }

  return slotContent;
}
