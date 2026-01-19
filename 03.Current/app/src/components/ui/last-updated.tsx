"use client";

import { Clock } from "lucide-react";

interface LastUpdatedProps {
    timestamp?: Date | null;
    label?: string;
    className?: string;
}

export function LastUpdated({ timestamp, label = "Last updated", className = "" }: LastUpdatedProps) {
    if (!timestamp) return null;

    const formatted = timestamp.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <span className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
            <Clock className="h-3 w-3" />
            {label}: {formatted}
        </span>
    );
}
