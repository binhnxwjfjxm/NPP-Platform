"use client";

import { useEffect, useState } from "react";
import { McpCustomerProfileSheet } from "./McpCustomerProfileSheet";
import {
  MCP_CUSTOMER_PROFILE_EVENT,
  type McpCustomerProfileRequest
} from "./mcp-customer-profile-events";

export function McpCustomerProfileEnhancer({
  sessionId,
  routeName
}: {
  sessionId: string;
  routeName: string;
}) {
  const [request, setRequest] = useState<McpCustomerProfileRequest | null>(null);

  useEffect(() => {
    function handle(event: Event) {
      const profileEvent = event as CustomEvent<McpCustomerProfileRequest>;
      if (!profileEvent.detail?.line) return;
      event.preventDefault();
      setRequest(profileEvent.detail);
    }

    window.addEventListener(MCP_CUSTOMER_PROFILE_EVENT, handle);
    return () => window.removeEventListener(MCP_CUSTOMER_PROFILE_EVENT, handle);
  }, []);

  return (
    <McpCustomerProfileSheet
      line={request?.line || null}
      sessionId={sessionId}
      routeName={routeName}
      focus={request?.focus || "detail"}
      open={Boolean(request)}
      onClose={() => setRequest(null)}
      onOpenActions={request?.fallback}
    />
  );
}
