import type { McpDayLine } from "@/features/mcp-day/mcp-day.types";

export const MCP_CUSTOMER_PROFILE_EVENT = "mcp:customer-profile";

export type McpCustomerProfileFocus = "detail" | "media";

export type McpCustomerProfileRequest = {
  line: McpDayLine;
  focus: McpCustomerProfileFocus;
  fallback?: () => void;
};

export function requestMcpCustomerProfile(request: McpCustomerProfileRequest) {
  const event = new CustomEvent<McpCustomerProfileRequest>(MCP_CUSTOMER_PROFILE_EVENT, {
    detail: request,
    cancelable: true
  });
  const notCancelled = window.dispatchEvent(event);
  if (notCancelled) request.fallback?.();
}
