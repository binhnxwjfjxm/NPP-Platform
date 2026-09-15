"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalReadCache } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { LocalReadDelta, LocalReadScope } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import { mcpLocalIdentity, useMcpLocalUserId } from "./mcp-local-identity";

export type McpLocalResource = "customers" | "orders" | "reports";
type LocalRow = { id: string; data: unknown };

const SCHEMA_VERSION = 1;
const REFRESH_MS = 30_000;
const REFRESH_EVENT = "mcp-local-resource-refresh";
const cache = createLocalReadCache<LocalRow>();
const memory = new Map<string, unknown>();

function resourceName(resource: McpLocalResource) {
  return `page.${resource}`;
}

function memoryKey(userId: string, resource: McpLocalResource) {
  return `${userId}:${resourceName(resource)}`;
}

function scope(userId: string, resource: McpLocalResource): LocalReadScope {
  return { ...mcpLocalIdentity(userId), resource: resourceName(resource), schemaVersion: SCHEMA_VERSION };
}

function dataFromRecord<T>(record: { rows: LocalRow[] } | null | undefined, resource: McpLocalResource): T | null {
  const row = record?.rows.find((item) => item?.id === resourceName(resource));
  return (row?.data as T | undefined) ?? null;
}

async function fetchDelta(resource: McpLocalResource, cursor: string | null): Promise<LocalReadDelta<LocalRow>> {
  const query = new URLSearchParams({ resource });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/local-read/mcp-page-data?${query.toString()}`, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null) as LocalReadDelta<LocalRow> | { error?: { code?: string } } | null;
  if (!response.ok || !payload || !("cursor" in payload) || !("upserts" in payload)) {
    const code = payload && "error" in payload ? payload.error?.code : undefined;
    if (response.status === 401) throw new Error("UNAUTHORIZED");
    if (response.status === 403) throw new Error("FORBIDDEN");
    throw new Error(code || `MCP_PAGE_LOCAL_READ_${response.status || 500}`);
  }
  return payload as LocalReadDelta<LocalRow>;
}

export function dispatchMcpLocalResourceRefresh(resource: McpLocalResource) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { resource } }));
}

export function useMcpLocalResource<T>(resource: McpLocalResource) {
  const userId = useMcpLocalUserId();
  const key = userId ? memoryKey(userId, resource) : "";
  const remembered = key ? memory.get(key) as T | undefined : undefined;
  const [data, setData] = useState<T | null>(() => remembered ?? null);
  const [source, setSource] = useState<"local" | "live" | null>(() => remembered ? "local" : null);
  const [loading, setLoading] = useState(() => Boolean(userId && !remembered));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<LocalReadScope | null>(null);
  const aliveRef = useRef(true);

  const applyRecord = useCallback((record: { rows: LocalRow[] } | null | undefined, nextSource: "local" | "live") => {
    if (!key) return false;
    const nextData = dataFromRecord<T>(record, resource);
    if (nextData === null) return false;
    memory.set(key, nextData);
    if (!aliveRef.current) return true;
    setData(nextData);
    setSource(nextSource);
    setLoading(false);
    return true;
  }, [key, resource]);

  const refresh = useCallback(async () => {
    const activeScope = scopeRef.current;
    if (!activeScope) return;
    setRefreshing(true);
    try {
      const next = await cache.refresh(activeScope, (cursor) => fetchDelta(resource, cursor));
      if (applyRecord(next, "live")) setError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      const message = cause instanceof Error ? cause.message : "MCP_PAGE_LOCAL_READ_UNAVAILABLE";
      setError(message);
      if (message === "UNAUTHORIZED") window.location.assign("/login");
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [applyRecord, resource]);

  useEffect(() => {
    aliveRef.current = true;
    scopeRef.current = null;
    if (!userId) {
      setData(null);
      setSource(null);
      setLoading(false);
      return () => { aliveRef.current = false; };
    }
    const activeKey = memoryKey(userId, resource);
    const existing = memory.get(activeKey) as T | undefined;
    setData(existing ?? null);
    setSource(existing ? "local" : null);
    setLoading(!existing);
    setError(null);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      const activeScope = scope(userId, resource);
      scopeRef.current = activeScope;
      const localFirst = await cache.readLocalFirst(activeScope, (cursor) => fetchDelta(resource, cursor));
      if (!aliveRef.current) return;
      applyRecord(localFirst.cached, "local");
      try {
        const fresh = await localFirst.refresh;
        if (!aliveRef.current) return;
        if (applyRecord(fresh, "live")) setError(null);
      } catch (cause) {
        if (!aliveRef.current) return;
        const message = cause instanceof Error ? cause.message : "MCP_PAGE_LOCAL_READ_UNAVAILABLE";
        setError(message);
        if (message === "UNAUTHORIZED") window.location.assign("/login");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
      if (!aliveRef.current) return;
      timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    };

    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ resource?: McpLocalResource }>).detail;
      if (detail?.resource === resource) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    void start();
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [applyRecord, refresh, resource, userId]);

  return { data, source, loading, refreshing, error, refresh };
}
