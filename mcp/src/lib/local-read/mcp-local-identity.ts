"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { LocalReadIdentity } from "../../../../packages/shared-utils/browser-local-read-cache.js";

const APP = "mcp-field";
const McpLocalIdentityContext = createContext<string | null>(null);
let currentUserId = "";

function installationNamespace() {
  const hostname = typeof window === "undefined" ? "local" : window.location.hostname.toLowerCase();
  const safe = hostname.replace(/[^a-z0-9._-]/g, "_") || "local";
  return `origin.${safe}`;
}

export function mcpLocalIdentity(userId: string): LocalReadIdentity {
  return { app: APP, installationId: installationNamespace(), userId };
}

export function McpLocalIdentityProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  currentUserId = String(userId || "").trim();
  return createElement(McpLocalIdentityContext.Provider, { value: currentUserId || null }, children);
}

export function useMcpLocalUserId() {
  return useContext(McpLocalIdentityContext);
}

export function currentMcpLocalUserId() {
  return currentUserId;
}
