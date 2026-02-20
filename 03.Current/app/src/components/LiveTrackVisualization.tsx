// GUID: LIVE_TRACK_VIZ-000-v01
// @FEATURE: Live track visualization with real-time car positions from OpenF1 location API.
// [Intent] Canvas-based circuit visualization showing car positions as colored dots with speed trails.
//          Color coding: Green (hot lap), Amber (in/out lap), Red (stationary).
//          Hover tooltips show driver names. Auto-update every 1 second when "Show Live" enabled.
// [Inbound Trigger] Rendered in PubChat Area 4 when session selected.
// [Downstream Impact] Fetches from /v1/location endpoint every 1s, renders on canvas.
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CarPosition {
    driverNumber: number;
    x: number; // GPS X coordinate
    y: number; // GPS Y coordinate
    z: number; // GPS Z coordinate (altitude)
    speed?: number; // Speed in km/h
    date?: string; // Timestamp
}

interface DriverInfo {
    driverNumber: number;
    driverName: string;
    teamColor: string;
}

interface TrailPoint {
    x: number;
    y: number;
    timestamp: number;
    opacity: number;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface LiveTrackVisualizationProps {
    sessionKey: number | null;
    authToken: string | null;
    drivers: DriverInfo[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CAR_DOT_RADIUS = 6;
const TRAIL_LENGTH = 15; // Number of trail points per car
const TRAIL_FADE_DURATION = 3000; // ms
const UPDATE_INTERVAL = 1000; // 1 second
const SPEED_THRESHOLD_STOPPED = 5; // km/h - below this is "stationary"
const SPEED_THRESHOLD_SLOW = 80; // km/h - below this is "in/out lap"

// ─── Component ──────────────────────────────────────────────────────────────

export function LiveTrackVisualization({ sessionKey, authToken, drivers }: LiveTrackVisualizationProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { toast } = useToast();

    // State
    const [isLive, setIsLive] = useState(false);
    const [positions, setPositions] = useState<CarPosition[]>([]);
    const [trails, setTrails] = useState<Map<number, TrailPoint[]>>(new Map());
    const [hoveredDriver, setHoveredDriver] = useState<number | null>(null);
    const [trackBounds, setTrackBounds] = useState<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Refs for animation loop
    const animationFrameRef = useRef<number>();
    const updateIntervalRef = useRef<NodeJS.Timeout>();

    // GUID: LIVE_TRACK_VIZ-001-v02
    // @FIX: Use server-side API route instead of direct OpenF1 call (fixes auth + CORS).
    // [Intent] Fetch car positions via /api/admin/openf1-location proxy.
    // [Inbound Trigger] Called every 1 second when isLive=true, or manually on "refresh".
    // [Downstream Impact] Updates positions state with latest GPS coordinates.
    const fetchPositions = useCallback(async () => {
        if (!sessionKey || !authToken) return;

        setIsLoading(true);
        try {
            const res = await fetch(`/api/admin/openf1-location?sessionKey=${sessionKey}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                },
            });

            const json = await res.json();

            if (!json.success || !res.ok) {
                console.warn('[Live Track] API returned error:', json.error || res.status);
                return;
            }

            const data: CarPosition[] = json.data || [];

            if (data.length === 0) {
                console.warn('[Live Track] No position data returned');
                return;
            }

            // Calculate track bounds if not set
            if (!trackBounds) {
                const xs = data.map(p => p.x);
                const ys = data.map(p => p.y);
                setTrackBounds({
                    minX: Math.min(...xs),
                    maxX: Math.max(...xs),
                    minY: Math.min(...ys),
                    maxY: Math.max(...ys),
                });
            }

            // Update positions
            setPositions(data);
            setLastUpdate(new Date());

            // Update trails (add new points, remove old ones)
            setTrails(prev => {
                const newTrails = new Map(prev);
                const now = Date.now();

                data.forEach(pos => {
                    const existing = newTrails.get(pos.driverNumber) || [];
                    const newPoint: TrailPoint = {
                        x: pos.x,
                        y: pos.y,
                        timestamp: now,
                        opacity: 1.0,
                    };

                    // Add new point and limit to TRAIL_LENGTH
                    const updated = [newPoint, ...existing].slice(0, TRAIL_LENGTH);
                    newTrails.set(pos.driverNumber, updated);
                });

                return newTrails;
            });

        } catch (err) {
            console.error('[Live Track] Fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [sessionKey, authToken, trackBounds]);

    // GUID: LIVE_TRACK_VIZ-002-v01
    // [Intent] Auto-update loop when "Show Live" is enabled.
    // [Inbound Trigger] isLive changes to true.
    // [Downstream Impact] Calls fetchPositions every UPDATE_INTERVAL (1 second).
    useEffect(() => {
        if (isLive && sessionKey && authToken) {
            // Initial fetch
            fetchPositions();

            // Set up interval
            updateIntervalRef.current = setInterval(fetchPositions, UPDATE_INTERVAL);

            return () => {
                if (updateIntervalRef.current) {
                    clearInterval(updateIntervalRef.current);
                }
            };
        }
    }, [isLive, sessionKey, authToken, fetchPositions]);

    // GUID: LIVE_TRACK_VIZ-003-v01
    // [Intent] Canvas rendering loop - draws track, cars, trails at 60fps.
    // [Inbound Trigger] positions or trails update.
    // [Downstream Impact] Renders on canvas element.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const render = () => {
            // Clear canvas
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

            if (!trackBounds || positions.length === 0) {
                // Show placeholder
                ctx.fillStyle = '#666';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No position data yet', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
                ctx.fillText('Select a session and click "Show Live"', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
                return;
            }

            // Helper to normalize GPS coordinates to canvas space
            const normalizeX = (x: number) => {
                const range = trackBounds.maxX - trackBounds.minX;
                return ((x - trackBounds.minX) / range) * (CANVAS_WIDTH - 40) + 20;
            };
            const normalizeY = (y: number) => {
                const range = trackBounds.maxY - trackBounds.minY;
                return ((y - trackBounds.minY) / range) * (CANVAS_HEIGHT - 40) + 20;
            };

            // Draw track outline (simplified convex hull or just bounds rectangle)
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(15, 15, CANVAS_WIDTH - 30, CANVAS_HEIGHT - 30);
            ctx.setLineDash([]);

            // Draw sector lines (approximate thirds)
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(CANVAS_WIDTH / 3, 15);
            ctx.lineTo(CANVAS_WIDTH / 3, CANVAS_HEIGHT - 15);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo((CANVAS_WIDTH / 3) * 2, 15);
            ctx.lineTo((CANVAS_WIDTH / 3) * 2, CANVAS_HEIGHT - 15);
            ctx.stroke();

            // Sector labels
            ctx.fillStyle = '#444';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('S1', CANVAS_WIDTH / 6, 30);
            ctx.fillText('S2', CANVAS_WIDTH / 2, 30);
            ctx.fillText('S3', (CANVAS_WIDTH / 6) * 5, 30);

            // Draw pit lane (simplified as a horizontal line at bottom)
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(20, CANVAS_HEIGHT - 30);
            ctx.lineTo(CANVAS_WIDTH / 3, CANVAS_HEIGHT - 30);
            ctx.stroke();
            ctx.fillStyle = '#666';
            ctx.font = '10px sans-serif';
            ctx.fillText('PIT', 60, CANVAS_HEIGHT - 35);

            const now = Date.now();

            // Draw trails first (behind cars)
            trails.forEach((trail, driverNumber) => {
                const driver = drivers.find(d => d.driverNumber === driverNumber);
                const color = driver ? `#${driver.teamColor}` : '#888';

                trail.forEach((point, idx) => {
                    const age = now - point.timestamp;
                    const opacity = Math.max(0, 1 - (age / TRAIL_FADE_DURATION));

                    if (opacity > 0.1) {
                        const x = normalizeX(point.x);
                        const y = normalizeY(point.y);
                        const size = 2 + (opacity * 2); // Smaller dots for trails

                        ctx.fillStyle = `${color}${Math.floor(opacity * 100).toString(16).padStart(2, '0')}`;
                        ctx.beginPath();
                        ctx.arc(x, y, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });
            });

            // Draw car dots
            positions.forEach(pos => {
                const driver = drivers.find(d => d.driverNumber === pos.driverNumber);
                const x = normalizeX(pos.x);
                const y = normalizeY(pos.y);

                // Determine color based on speed
                let dotColor: string;
                if (!pos.speed || pos.speed < SPEED_THRESHOLD_STOPPED) {
                    dotColor = '#ef4444'; // Red - stationary
                } else if (pos.speed < SPEED_THRESHOLD_SLOW) {
                    dotColor = '#f59e0b'; // Amber - in/out lap
                } else {
                    dotColor = '#22c55e'; // Green - hot lap
                }

                // Draw outer ring if hovered
                if (hoveredDriver === pos.driverNumber) {
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, CAR_DOT_RADIUS + 3, 0, Math.PI * 2);
                    ctx.stroke();
                }

                // Draw car dot
                ctx.fillStyle = dotColor;
                ctx.beginPath();
                ctx.arc(x, y, CAR_DOT_RADIUS, 0, Math.PI * 2);
                ctx.fill();

                // Draw driver number inside dot
                ctx.fillStyle = '#000';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(pos.driverNumber), x, y);
            });

            animationFrameRef.current = requestAnimationFrame(render);
        };

        render();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [positions, trails, trackBounds, hoveredDriver, drivers]);

    // GUID: LIVE_TRACK_VIZ-004-v01
    // [Intent] Mouse hover detection for driver tooltips.
    // [Inbound Trigger] Mouse move over canvas.
    // [Downstream Impact] Updates hoveredDriver state for tooltip rendering.
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current || !trackBounds) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Normalize function (same as in render)
        const normalizeX = (x: number) => {
            const range = trackBounds.maxX - trackBounds.minX;
            return ((x - trackBounds.minX) / range) * (CANVAS_WIDTH - 40) + 20;
        };
        const normalizeY = (y: number) => {
            const range = trackBounds.maxY - trackBounds.minY;
            return ((y - trackBounds.minY) / range) * (CANVAS_HEIGHT - 40) + 20;
        };

        // Check if mouse is near any car dot
        let found: number | null = null;
        for (const pos of positions) {
            const x = normalizeX(pos.x);
            const y = normalizeY(pos.y);
            const distance = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);

            if (distance <= CAR_DOT_RADIUS + 5) {
                found = pos.driverNumber;
                break;
            }
        }

        setHoveredDriver(found);
    };

    const handleMouseLeave = () => {
        setHoveredDriver(null);
    };

    const toggleLive = () => {
        setIsLive(prev => !prev);
        if (!isLive) {
            toast({
                title: 'Live tracking enabled',
                description: 'Updating positions every 1 second',
            });
        }
    };

    // Get driver info for tooltip
    const hoveredDriverInfo = hoveredDriver !== null
        ? drivers.find(d => d.driverNumber === hoveredDriver)
        : null;

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        onClick={toggleLive}
                        disabled={!sessionKey || !authToken}
                        variant={isLive ? 'default' : 'outline'}
                        size="sm"
                    >
                        {isLive ? (
                            <>
                                <Pause className="h-4 w-4 mr-2" />
                                Pause Live
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 mr-2" />
                                Show Live
                            </>
                        )}
                    </Button>

                    {!isLive && (
                        <Button
                            onClick={fetchPositions}
                            disabled={!sessionKey || !authToken || isLoading}
                            variant="outline"
                            size="sm"
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            Manual Refresh
                        </Button>
                    )}
                </div>

                {lastUpdate && (
                    <span className="text-xs text-muted-foreground">
                        Last update: {lastUpdate.toLocaleTimeString()}
                    </span>
                )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-muted-foreground">Hot Lap (&gt;80 km/h)</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <span className="text-muted-foreground">In/Out Lap (5-80 km/h)</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-muted-foreground">Stationary (&lt;5 km/h)</span>
                </div>
            </div>

            {/* Canvas */}
            <div className="relative">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="border border-border rounded-lg bg-black cursor-crosshair"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    style={{ width: '100%', height: 'auto' }}
                />

                {/* Hover tooltip */}
                {hoveredDriverInfo && (
                    <div className="absolute top-2 left-2 bg-background/95 border rounded-lg px-3 py-2 shadow-lg">
                        <p className="text-sm font-semibold">#{hoveredDriverInfo.driverNumber} {hoveredDriverInfo.driverName}</p>
                        <p className="text-xs text-muted-foreground">
                            {positions.find(p => p.driverNumber === hoveredDriverInfo.driverNumber)?.speed?.toFixed(0) || '—'} km/h
                        </p>
                    </div>
                )}
            </div>

            {/* Stats */}
            <div className="text-xs text-muted-foreground">
                {positions.length} car{positions.length !== 1 ? 's' : ''} on track
                {isLive && ' • Live updates every 1 second'}
            </div>
        </div>
    );
}
