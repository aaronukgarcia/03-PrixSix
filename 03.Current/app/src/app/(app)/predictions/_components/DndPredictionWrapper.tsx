"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Driver } from "@/lib/data";
import { DragOverlayContent } from "./DragOverlayContent";

interface DndPredictionWrapperProps {
  children: React.ReactNode;
  predictions: (Driver | null)[];
  availableDrivers: Driver[];
  onDropToSlot: (driverId: string, slotIndex: number) => void;
  onSwapSlots: (fromIndex: number, toIndex: number) => void;
  onRemoveFromGrid: (slotIndex: number) => void;
}

function parsePoolId(id: string): string | null {
  if (id.startsWith("pool-")) return id.slice(5);
  return null;
}

function parseSlotIndex(id: string): number | null {
  if (id.startsWith("slot-")) {
    const idx = parseInt(id.slice(5), 10);
    return isNaN(idx) ? null : idx;
  }
  return null;
}

export function DndPredictionWrapper({
  children,
  predictions,
  availableDrivers,
  onDropToSlot,
  onSwapSlots,
  onRemoveFromGrid,
}: DndPredictionWrapperProps) {
  const [activeDriver, setActiveDriver] = useState<Driver | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setActiveId(id);

      const poolDriverId = parsePoolId(id);
      if (poolDriverId) {
        const driver = availableDrivers.find((d) => d.id === poolDriverId) ?? null;
        setActiveDriver(driver);
        return;
      }

      const slotIndex = parseSlotIndex(id);
      if (slotIndex !== null) {
        setActiveDriver(predictions[slotIndex] ?? null);
      }
    },
    [availableDrivers, predictions]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDriver(null);
      setActiveId(null);

      if (!over) return;

      const activeStr = String(active.id);
      const overStr = String(over.id);

      const poolDriverId = parsePoolId(activeStr);
      const activeSlotIndex = parseSlotIndex(activeStr);
      const overSlotIndex = parseSlotIndex(overStr);
      const isOverPool = overStr === "pool-zone";

      // Pool driver -> Grid slot
      if (poolDriverId !== null && overSlotIndex !== null) {
        onDropToSlot(poolDriverId, overSlotIndex);
        return;
      }

      // Grid slot -> Grid slot (swap)
      if (activeSlotIndex !== null && overSlotIndex !== null && activeSlotIndex !== overSlotIndex) {
        onSwapSlots(activeSlotIndex, overSlotIndex);
        return;
      }

      // Grid slot -> Pool zone (remove)
      if (activeSlotIndex !== null && isOverPool) {
        onRemoveFromGrid(activeSlotIndex);
        return;
      }
    },
    [onDropToSlot, onSwapSlots, onRemoveFromGrid]
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeDriver ? <DragOverlayContent driver={activeDriver} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
