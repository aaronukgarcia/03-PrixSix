"use client";

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
