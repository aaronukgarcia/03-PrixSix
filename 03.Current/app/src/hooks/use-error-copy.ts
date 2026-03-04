"use client";

// GUID: HOOK_USE_ERROR_COPY-000-v01
// [Intent] React hook that builds a copyable error string (errorCode | correlationId | digest | moduleName) and provides a handleCopy callback with a 2-second "copied" confirmation state — implements Golden Rule #1's selectable-error requirement.
// [Inbound Trigger] Used by all user-facing error display components (dialogs, toasts, error pages) that must allow users to copy their error code.
// [Downstream Impact] Clipboard write gives users a string they can paste into support requests; digest and moduleName are optional fields for Next.js error boundaries.
import { useState, useCallback, useMemo } from "react";

interface UseErrorCopyParams {
  errorCode: string;
  correlationId: string;
  digest?: string;
  moduleName?: string;
}

export function useErrorCopy({
  errorCode,
  correlationId,
  digest,
  moduleName,
}: UseErrorCopyParams) {
  const [copied, setCopied] = useState(false);

  const copyText = useMemo(() => {
    const parts = [errorCode, correlationId];
    if (digest) parts.push(`digest:${digest}`);
    if (moduleName) parts.push(`Module: ${moduleName}`);
    return parts.join(" | ");
  }, [errorCode, correlationId, digest, moduleName]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [copyText]);

  return { copyText, handleCopy, copied };
}
