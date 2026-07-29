// GUID: INSTRUMENTATION-000-v01
// [Intent] Next.js instrumentation entry point. Provides onRequestError — the ONLY
//          hook that receives UNREDACTED Server Component render errors in production.
//          Next.js strips RSC error messages before they reach the browser (the client
//          sees "message omitted in production builds" + a digest); this hook captures
//          the real error server-side and persists it to error_logs with the same
//          digest, so a redacted client report can be joined to the full server truth
//          with one Firestore query on the digest field.
// [Inbound Trigger] Loaded automatically by Next.js at server startup (stable since
//                   Next 15 — no experimental.instrumentationHook flag needed on 16.x).
//                   onRequestError fires for every UNCAUGHT server error: RSC renders,
//                   server actions, route handlers, middleware.
// [Downstream Impact] Writes registry error PX-9003 (SERVER_UNCAUGHT_ERROR) docs to
//                     error_logs via logError(). Admin-only collection (firestore.rules)
//                     — debug detail is never client-readable. GR#17 amendment:
//                     error_logs is where we look, so uncaught server errors must land
//                     there, not only in Cloud Run logs.

// GUID: INSTRUMENTATION-001-v01
// [Intent] register() — required export. No startup instrumentation needed; exists so
//          Next.js treats this file as a valid instrumentation module in all runtimes.
// [Inbound Trigger] Called once per server process start (nodejs and edge).
// [Downstream Impact] None.
export async function register(): Promise<void> {
  // No startup work required.
}

// GUID: INSTRUMENTATION-002-v01
// [Intent] Capture every uncaught server error with FULL detail (message, stack,
//          digest, route, method, user-agent) and persist it to error_logs. Skips
//          Next.js control-flow "errors" (NEXT_REDIRECT / NEXT_NOT_FOUND digests).
//          Caught errors in API routes never reach this hook (GR#1 catch blocks
//          handle + log those themselves), so double-logging cannot occur.
// [Inbound Trigger] Next.js invokes on any uncaught error during render / server
//                   action / route handler / middleware execution.
// [Downstream Impact] error_logs docs carry top-level errorCode PX-9003 and digest.
//                     Client-side redacted reports (log-client-error) store the same
//                     digest — join key for triage. MUST NEVER THROW: a crash here
//                     would recurse; everything is wrapped and logError itself
//                     swallows its own failures.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
    revalidateReason?: string;
  },
): Promise<void> {
  try {
    // firebase-admin is Node-only — never attempt in the edge runtime.
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const error = err instanceof Error ? err : new Error(String(err));
    const digest = (err as { digest?: string })?.digest;

    // NEXT_REDIRECT / NEXT_NOT_FOUND etc. are framework control flow, not failures.
    if (typeof digest === 'string' && digest.startsWith('NEXT_')) return;

    // Dynamic import keeps the Admin SDK out of the edge bundle.
    const { logError, generateCorrelationId } = await import('@/lib/firebase-admin');
    const { ERRORS } = await import('@/lib/error-registry');

    const rawUa = request.headers?.['user-agent'];
    const userAgent = Array.isArray(rawUa) ? rawUa[0] : rawUa;

    await logError({
      correlationId: generateCorrelationId(),
      errorCode: ERRORS.SERVER_UNCAUGHT_ERROR.code,
      error,
      digest,
      context: {
        route: context.routePath || request.path,
        action: `${request.method} uncaught (${context.routeType})`,
        userAgent,
        additionalInfo: {
          errorCode: ERRORS.SERVER_UNCAUGHT_ERROR.code,
          source: 'server-instrumentation',
          routerKind: context.routerKind,
          routeType: context.routeType,
          renderSource: context.renderSource,
          revalidateReason: context.revalidateReason,
          requestPath: request.path,
        },
      },
    });
  } catch {
    // Deliberately swallowed — an error logger that throws would recurse.
    // logError already console-logs its own failures in non-production.
  }
}
