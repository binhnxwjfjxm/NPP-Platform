"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { McpDayData } from "@/features/mcp-day/mcp-day.types";
import { createLocalReadCache } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { LocalReadDelta, LocalReadScope } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import { mcpLocalIdentity, useMcpLocalUserId } from "./mcp-local-identity";
import { MCP_LOCAL_READ_REFRESH_EVENT } from "./use-mcp-shell";

type VisitDayRow = { id: "visit-day"; data: McpDayData };

const SCHEMA_VERSION = 1;
const REFRESH_MS = 15_000;
const cache = createLocalReadCache<VisitDayRow>();
const memory = new Map<string, McpDayData>();

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resourceName(routeId: string, date: string) {
  return `visit-day.${routeId}.${date}`;
}

function memoryKey(userId: string, routeId: string, date: string) {
  return `${userId}:${resourceName(routeId, date)}`;
}

function scope(userId: string, routeId: string, date: string): LocalReadScope {
  return { ...mcpLocalIdentity(userId), resource: resourceName(routeId, date), schemaVersion: SCHEMA_VERSION };
}

function dataFromRecord(record: { rows: VisitDayRow[] } | null | undefined) {
  return record?.rows.find((row) => row.id === "visit-day")?.data ?? null;
}

async function fetchDelta(routeId: string, date: string, cursor: string | null): Promise<LocalReadDelta<VisitDayRow>> {
  const query = new URLSearchParams({ routeId, date });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/local-read/mcp-visit-day?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => null) as LocalReadDelta<VisitDayRow> | { error?: { code?: string } } | null;
  if (!response.ok || !payload || !("cursor" in payload) || !("upserts" in payload)) {
    const code = payload && "error" in payload ? payload.error?.code : undefined;
    if (response.status === 401) throw new Error("UNAUTHORIZED");
    throw new Error(code || `MCP_VISIT_DAY_${response.status || 500}`);
  }
  return payload as LocalReadDelta<VisitDayRow>;
}

export function useMcpVisitDay(routeId: string, date: string) {
  const userId = useMcpLocalUserId();
  const usable = Boolean(userId && routeId && validDate(date));
  const key = usable && userId ? memoryKey(userId, routeId, date) : "";
  const remembered = key ? memory.get(key) ?? null : null;
  const [data, setData] = useState<McpDayData | null>(() => remembered);
  const [source, setSource] = useState<"local" | "live" | null>(() => remembered ? "local" : null);
  const [loading, setLoading] = useState(() => usable && !remembered);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<LocalReadScope | null>(null);
  const aliveRef = useRef(true);

  const applyRecord = useCallback((record: { rows: VisitDayRow[] } | null | undefined, nextSource: "local" | "live") => {
    if (!key) return false;
    const next = dataFromRecord(record);
    if (!next) return false;
    memory.set(key, next);
    if (!aliveRef.current) return true;
    setData(next);
    setSource(nextSource);
    setLoading(false);
    return true;
  }, [key]);

  const refresh = useCallback(async () => {
    const activeScope = scopeRef.current;
    if (!activeScope || !routeId || !validDate(date)) return;
    setRefreshing(true);
    try {
      const next = await cache.refresh(activeScope, (cursor) => fetchDelta(routeId, date, cursor));
      if (applyRecord(next, "live")) setError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      const message = cause instanceof Error ? cause.message : "MCP_VISIT_DAY_UNAVAILABLE";
      setError(message);
      if (message === "UNAUTHORIZED") window.location.assign("/login");
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [applyRecord, date, routeId]);

  useEffect(() => {
    aliveRef.current = true;
    scopeRef.current = null;
    if (!userId || !routeId || !validDate(date)) {
      setData(null);
      setSource(null);
      setLoading(false);
      return () => { aliveRef.current = false; };
    }

    const activeKey = memoryKey(userId, routeId, date);
    const existing = memory.get(activeKey) ?? null;
    setData(existing);
    setSource(existing ? "local" : null);
    setLoading(!existing);
    setError(null);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      const activeScope = scope(userId, routeId, date);
      scopeRef.current = activeScope;
      const localFirst = await cache.readLocalFirst(activeScope, (cursor) => fetchDelta(routeId, date, cursor));
      if (!aliveRef.current) return;
      applyRecord(localFirst.cached, "local");
      try {
        const fresh = await localFirst.refresh;
        if (!aliveRef.current) return;
        if (applyRecord(fresh, "live")) setError(null);
      } catch (cause) {
        if (!aliveRef.current) return;
        const message = cause instanceof Error ? cause.message : "MCP_VISIT_DAY_UNAVAILABLE";
        setError(message);
        if (message === "UNAUTHORIZED") window.location.assign("/login");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
      if (!aliveRef.current) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, REFRESH_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
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
  }, [applyRecord, date, refresh, routeId, userId]);

  return { data, source, loading, refreshing, error, refresh };
}
