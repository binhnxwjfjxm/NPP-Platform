"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalReadCache } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { LocalReadDelta, LocalReadIdentity, LocalReadScope } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { McpShellCacheRow, McpShellSnapshot } from "./mcp-shell-types";

const APP = "mcp-field";
const RESOURCE = "mcp-shell";
const SCHEMA_VERSION = 1;
const REFRESH_MS = 30_000;
export const MCP_LOCAL_READ_REFRESH_EVENT = "mcp-local-read-refresh";

const cache = createLocalReadCache<McpShellCacheRow>();

function installationNamespace() {
  const hostname = typeof window === "undefined" ? "local" : window.location.hostname.toLowerCase();
  const safe = hostname.replace(/[^a-z0-9._-]/g, "_") || "local";
  // NPP Platform deploys one customer installation per MCP origin. The origin is therefore
  // the stable browser-side installation namespace; backend data remains installation-scoped.
  return `origin.${safe}`;
}

function identity(userId: string): LocalReadIdentity {
  return { app: APP, installationId: installationNamespace(), userId };
}

function scope(userId: string): LocalReadScope {
  return { ...identity(userId), resource: RESOURCE, schemaVersion: SCHEMA_VERSION };
}

function snapshotFromRecord(record: { rows: McpShellCacheRow[] } | null | undefined) {
  const row = record?.rows.find((item) => item?.id === "mcp-shell");
  return row?.snapshot || null;
}

async function currentEmployeeId() {
  const response = await fetch("/api/auth/me", { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null) as { data?: { employeeId?: string } } | null;
  const employeeId = String(payload?.data?.employeeId || "").trim();
  if (!response.ok || !employeeId) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "MCP_AUTH_UNAVAILABLE");
  return employeeId;
}

async function fetchDelta(cursor: string | null): Promise<LocalReadDelta<McpShellCacheRow>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/local-read/mcp-shell${query}`, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null) as LocalReadDelta<McpShellCacheRow> | { error?: { code?: string } } | null;
  if (!response.ok || !payload || !("cursor" in payload) || !("upserts" in payload)) {
    const code = payload && "error" in payload ? payload.error?.code : undefined;
    throw new Error(code || `MCP_LOCAL_READ_${response.status || 500}`);
  }
  return payload as LocalReadDelta<McpShellCacheRow>;
}

export function dispatchMcpLocalReadRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MCP_LOCAL_READ_REFRESH_EVENT));
}

export async function clearMcpLocalReadForCurrentUser() {
  try {
    const employeeId = await currentEmployeeId();
    await cache.clearIdentity(identity(employeeId));
  } catch {
    // Logout must continue even when local storage or the session check is unavailable.
  }
}

export function useMcpShellSnapshot() {
  const [snapshot, setSnapshot] = useState<McpShellSnapshot | null>(null);
  const [source, setSource] = useState<"local" | "live" | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<LocalReadScope | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    const activeScope = scopeRef.current;
    if (!activeScope) return;
    setRefreshing(true);
    try {
      const next = await cache.refresh(activeScope, fetchDelta);
      if (!aliveRef.current) return;
      const nextSnapshot = snapshotFromRecord(next);
      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
        setSource("live");
        setError(null);
      }
    } catch (cause) {
      if (!aliveRef.current) return;
      setError(cause instanceof Error ? cause.message : "MCP_LOCAL_READ_UNAVAILABLE");
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = async () => {
      try {
        const employeeId = await currentEmployeeId();
        if (!aliveRef.current) return;
        const activeScope = scope(employeeId);
        scopeRef.current = activeScope;
        const localFirst = await cache.readLocalFirst(activeScope, fetchDelta);
        if (!aliveRef.current) return;
        const cached = snapshotFromRecord(localFirst.cached);
        if (cached) {
          setSnapshot(cached);
          setSource("local");
          setLoading(false);
        }
        try {
          const fresh = await localFirst.refresh;
          if (!aliveRef.current) return;
          const next = snapshotFromRecord(fresh);
          if (next) {
            setSnapshot(next);
            setSource("live");
            setError(null);
          }
        } catch (cause) {
          if (aliveRef.current) setError(cause instanceof Error ? cause.message : "MCP_LOCAL_READ_UNAVAILABLE");
        } finally {
          if (aliveRef.current) setLoading(false);
        }
        timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
      } catch (cause) {
        if (!aliveRef.current) return;
        const message = cause instanceof Error ? cause.message : "MCP_AUTH_UNAVAILABLE";
        setError(message);
        setLoading(false);
        if (message === "UNAUTHORIZED") window.location.assign("/login");
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onRefresh = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(MCP_LOCAL_READ_REFRESH_EVENT, onRefresh);
    void start();
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(MCP_LOCAL_READ_REFRESH_EVENT, onRefresh);
    };
  }, [refresh]);

  return { snapshot, source, loading, refreshing, error, refresh };
}
