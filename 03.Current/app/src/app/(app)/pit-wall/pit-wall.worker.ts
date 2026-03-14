// GUID: PIT_WALL_WORKER-000-v01
// [Intent] Web Worker for off-main-thread JSON parsing of Pit Wall live data responses.
//          Receives raw response text, parses it, and posts the result back to the main thread.
// [Inbound Trigger] Instantiated by usePitWallData via new Worker(new URL(..., import.meta.url)).
// [Downstream Impact] Keeps JSON.parse of large OpenF1 payloads off the React render thread.

/// <reference lib="webworker" />

// GUID: PIT_WALL_WORKER-001-v01
// [Intent] Message handler — receives PROCESS_JSON requests, parses the raw text, posts result or error.
type WorkerInbound =
  | { type: 'PROCESS_JSON'; rawText: string; requestId: number };

type WorkerOutbound =
  | { type: 'PROCESS_RESULT'; requestId: number; data: any }
  | { type: 'PROCESS_ERROR'; requestId: number; message: string };

self.onmessage = (event: MessageEvent) => {
  const msg = event.data as WorkerInbound;
  if (msg.type === 'PROCESS_JSON') {
    try {
      const data = JSON.parse(msg.rawText);
      (self as unknown as Worker).postMessage({ type: 'PROCESS_RESULT', requestId: msg.requestId, data } as WorkerOutbound);
    } catch (err: any) {
      (self as unknown as Worker).postMessage({ type: 'PROCESS_ERROR', requestId: msg.requestId, message: err?.message ?? 'JSON parse failed' } as WorkerOutbound);
    }
  }
};
