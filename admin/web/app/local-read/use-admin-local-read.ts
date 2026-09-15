"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalReadCache } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { LocalReadDelta, LocalReadIdentity, LocalReadScope } from "../../../../packages/shared-utils/browser-local-read-cache.js";

const APP = "admin-mcp-npp";
const SCHEMA_VERSION = 1;
const REFRESH_MS = 30_000;
const cache = createLocalReadCache<AdminLocalReadRow>();

export type AdminLocalReadKind = "control-tower" | "proposals" | "alerts";
type AdminLocalReadRow = { id: string; data: unknown };
type AuthMePayload = { data?: { cacheUserId?: string | null } };

function installationNamespace() {
  const hostname = typeof window === "undefined" ? "local" : window.location.hostname.toLowerCase();
  const safe = hostname.replace(/[^a-z0-9._-]/g, "_") || "local";
  return `origin.${safe}`;
}

function identity(userId: string): LocalReadIdentity {
  return { app: APP, installationId: installationNamespace(), userId };
}

function periodKey(period: string) {
  if (period === "Hôm nay") return "today";
  if (period === "7 ngày") return "7d";
  if (period === "Quý này") return "quarter";
  return "month";
}

function resourceName(kind: AdminLocalReadKind, period: string) {
  if (kind === "proposals") return "proposals";
  return `${kind}.${periodKey(period)}`;
}

function scope(userId: string, kind: AdminLocalReadKind, period: string): LocalReadScope {
  return { ...identity(userId), resource: resourceName(kind, period), schemaVersion: SCHEMA_VERSION };
}

function dataFromRecord<T>(record: { rows: AdminLocalReadRow[] } | null | undefined, resource: string): T | null {
  const row = record?.rows.find((item) => item?.id === resource);
  return (row?.data as T | undefined) ?? null;
}

async function currentCacheUserId() {
  const response = await fetch("/api/auth/me", { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => null) as AuthMePayload | null;
  const userId = String(payload?.data?.cacheUserId || "").trim();
  if (!response.ok || !userId) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "ADMIN_AUTH_UNAVAILABLE");
  return userId;
}

async function fetchDelta(kind: AdminLocalReadKind, period: string, cursor: string | null): Promise<LocalReadDelta<AdminLocalReadRow>> {
  const query = new URLSearchParams({ resource: kind, period });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/local-read/admin-data?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as LocalReadDelta<AdminLocalReadRow> | { error?: { code?: string } } | null;
  if (!response.ok || !payload || !("cursor" in payload) || !("upserts" in payload)) {
    const code = payload && "error" in payload ? payload.error?.code : undefined;
    if (response.status === 401) throw new Error("UNAUTHORIZED");
    if (response.status === 403) throw new Error("FORBIDDEN");
    throw new Error(code || `ADMIN_LOCAL_READ_${response.status || 500}`);
  }
  return payload as LocalReadDelta<AdminLocalReadRow>;
}

export async function clearAdminLocalReadForCurrentUser() {
  try {
    const userId = await currentCacheUserId();
    await cache.clearIdentity(identity(userId));
  } catch {
    // Logout must continue even if the local cache or current-session check is unavailable.
  }
}

export function useAdminLocalRead<T>(kind: AdminLocalReadKind, period = "Tháng này") {
  const [data, setData] = useState<T | null>(null);
  const [source, setSource] = useState<"local" | "live" | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const scopeRef = useRef<LocalReadScope | null>(null);
  const aliveRef = useRef(true);

  const resource = resourceName(kind, period);

  const refresh = useCallback(async () => {
    const activeScope = scopeRef.current;
    if (!activeScope) return;
    setRefreshing(true);
    try {
      const next = await cache.refresh(activeScope, (cursor) => fetchDelta(kind, period, cursor));
      if (!aliveRef.current) return;
      const nextData = dataFromRecord<T>(next, resource);
      if (nextData !== null) {
        setData(nextData);
        setSource("live");
        setSavedAt(next.savedAt);
        setError(null);
      }
    } catch (cause) {
      if (!aliveRef.current) return;
      const message = cause instanceof Error ? cause.message : "ADMIN_LOCAL_READ_UNAVAILABLE";
      if (message === "FORBIDDEN") {
        await cache.clearResource(activeScope);
        if (!aliveRef.current) return;
        setData(null);
        setSource(null);
      }
      setError(message);
      if (message === "UNAUTHORIZED") window.location.assign("/login");
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [kind, period, resource]);

  useEffect(() => {
    aliveRef.current = true;
    scopeRef.current = null;
    setData(null);
    setSource(null);
    setError(null);
    setSavedAt(null);
    setLoading(true);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      try {
        const userId = await currentCacheUserId();
        if (!aliveRef.current) return;
        const activeScope = scope(userId, kind, period);
        scopeRef.current = activeScope;
        const localFirst = await cache.readLocalFirst(activeScope, (cursor) => fetchDelta(kind, period, cursor));
        if (!aliveRef.current) return;
        const cachedData = dataFromRecord<T>(localFirst.cached, resource);
        if (cachedData !== null) {
          setData(cachedData);
          setSource("local");
          setSavedAt(localFirst.cached?.savedAt ?? null);
          setLoading(false);
        }
        try {
          const fresh = await localFirst.refresh;
          if (!aliveRef.current) return;
          const freshData = dataFromRecord<T>(fresh, resource);
          if (freshData !== null) {
            setData(freshData);
            setSource("live");
            setSavedAt(fresh.savedAt);
            setError(null);
          }
        } catch (cause) {
          if (!aliveRef.current) return;
          const message = cause instanceof Error ? cause.message : "ADMIN_LOCAL_READ_UNAVAILABLE";
          if (message === "FORBIDDEN") {
            await cache.clearResource(activeScope);
            if (!aliveRef.current) return;
            setData(null);
            setSource(null);
          }
          setError(message);
          if (message === "UNAUTHORIZED") window.location.assign("/login");
        } finally {
          if (aliveRef.current) setLoading(false);
        }
        timer = setInterval(() => {
          if (document.visibilityState === "visible") void refresh();
        }, REFRESH_MS);
      } catch (cause) {
        if (!aliveRef.current) return;
        const message = cause instanceof Error ? cause.message : "ADMIN_AUTH_UNAVAILABLE";
        setError(message);
        setLoading(false);
        if (message === "UNAUTHORIZED") window.location.assign("/login");
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    void start();
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [kind, period, refresh, resource]);

  return { data, source, loading, refreshing, error, savedAt, refresh };
}
