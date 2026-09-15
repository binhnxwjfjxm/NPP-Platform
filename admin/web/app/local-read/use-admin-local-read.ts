"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLocalReadCache } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import type { LocalReadDelta, LocalReadScope } from "../../../../packages/shared-utils/browser-local-read-cache.js";
import { adminLocalIdentity, currentAdminLocalUserId, useAdminLocalUserId } from "./admin-local-identity";

const SCHEMA_VERSION = 1;
const REFRESH_MS = 30_000;
const cache = createLocalReadCache<AdminLocalReadRow>();
const memory = new Map<string, { data: unknown; savedAt: string | null }>();

export type AdminLocalReadKind = "control-tower" | "proposals" | "alerts" | "reports";
type AdminLocalReadRow = { id: string; data: unknown };
export type AdminLocalReadOptions = { tab?: string | null; warehouseId?: string | null };

function periodKey(period: string) {
  if (period === "Hôm nay") return "today";
  if (period === "7 ngày") return "7d";
  if (period === "Quý này") return "quarter";
  return "month";
}

function reportQualifier(options?: AdminLocalReadOptions) {
  const tab = String(options?.tab || "executive").replace(/[^A-Za-z0-9._-]/g, "_");
  const warehouse = String(options?.warehouseId || "all").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${tab}.${warehouse}`;
}

function resourceName(kind: AdminLocalReadKind, period: string, options?: AdminLocalReadOptions) {
  if (kind === "proposals") return "proposals";
  if (kind === "reports") return `reports.${reportQualifier(options)}.${periodKey(period)}`;
  return `${kind}.${periodKey(period)}`;
}

function memoryKey(userId: string, resource: string) {
  return `${userId}:${resource}`;
}

function scope(userId: string, kind: AdminLocalReadKind, period: string, options?: AdminLocalReadOptions): LocalReadScope {
  return { ...adminLocalIdentity(userId), resource: resourceName(kind, period, options), schemaVersion: SCHEMA_VERSION };
}

function dataFromRecord<T>(record: { rows: AdminLocalReadRow[] } | null | undefined, resource: string): T | null {
  const row = record?.rows.find((item) => item?.id === resource);
  return (row?.data as T | undefined) ?? null;
}

async function fetchDelta(kind: AdminLocalReadKind, period: string, options: AdminLocalReadOptions | undefined, cursor: string | null): Promise<LocalReadDelta<AdminLocalReadRow>> {
  const query = new URLSearchParams({ resource: kind, period });
  if (options?.tab) query.set("tab", options.tab);
  if (options?.warehouseId) query.set("warehouseId", options.warehouseId);
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/local-read/admin-data?${query.toString()}`, { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
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
  const userId = currentAdminLocalUserId();
  try {
    if (userId) await cache.clearIdentity(adminLocalIdentity(userId));
  } catch {
    // Logout must continue even if IndexedDB is unavailable.
  } finally {
    memory.clear();
  }
}

export function useAdminLocalRead<T>(kind: AdminLocalReadKind, period = "Tháng này", options?: AdminLocalReadOptions) {
  const userId = useAdminLocalUserId();
  const stableOptions = useMemo(() => ({ tab: options?.tab ?? null, warehouseId: options?.warehouseId ?? null }), [options?.tab, options?.warehouseId]);
  const resource = resourceName(kind, period, stableOptions);
  const key = userId ? memoryKey(userId, resource) : "";
  const remembered = key ? memory.get(key) : undefined;
  const [data, setData] = useState<T | null>(() => (remembered?.data as T | undefined) ?? null);
  const [source, setSource] = useState<"local" | "live" | null>(() => remembered ? "local" : null);
  const [loading, setLoading] = useState(() => Boolean(userId && !remembered));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(() => remembered?.savedAt ?? null);
  const scopeRef = useRef<LocalReadScope | null>(null);
  const aliveRef = useRef(true);

  const applyRecord = useCallback((record: { rows: AdminLocalReadRow[]; savedAt: string } | null | undefined, nextSource: "local" | "live") => {
    if (!key) return false;
    const nextData = dataFromRecord<T>(record, resource);
    if (nextData === null) return false;
    memory.set(key, { data: nextData, savedAt: record?.savedAt ?? null });
    if (!aliveRef.current) return true;
    setData(nextData);
    setSource(nextSource);
    setSavedAt(record?.savedAt ?? null);
    setLoading(false);
    return true;
  }, [key, resource]);

  const refresh = useCallback(async () => {
    const activeScope = scopeRef.current;
    if (!activeScope) return;
    setRefreshing(true);
    try {
      const next = await cache.refresh(activeScope, (cursor) => fetchDelta(kind, period, stableOptions, cursor));
      if (applyRecord(next, "live")) setError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      const message = cause instanceof Error ? cause.message : "ADMIN_LOCAL_READ_UNAVAILABLE";
      if (message === "FORBIDDEN") {
        await cache.clearResource(activeScope);
        if (key) memory.delete(key);
        setData(null);
        setSource(null);
      }
      setError(message);
      if (message === "UNAUTHORIZED") window.location.assign("/login");
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [applyRecord, key, kind, period, stableOptions]);

  useEffect(() => {
    aliveRef.current = true;
    scopeRef.current = null;
    if (!userId) {
      setData(null);
      setSource(null);
      setSavedAt(null);
      setLoading(false);
      return () => { aliveRef.current = false; };
    }
    const activeKey = memoryKey(userId, resource);
    const existing = memory.get(activeKey);
    setData((existing?.data as T | undefined) ?? null);
    setSource(existing ? "local" : null);
    setError(null);
    setSavedAt(existing?.savedAt ?? null);
    setLoading(!existing);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      const activeScope = scope(userId, kind, period, stableOptions);
      scopeRef.current = activeScope;
      const localFirst = await cache.readLocalFirst(activeScope, (cursor) => fetchDelta(kind, period, stableOptions, cursor));
      if (!aliveRef.current) return;
      applyRecord(localFirst.cached, "local");
      try {
        const fresh = await localFirst.refresh;
        if (!aliveRef.current) return;
        if (applyRecord(fresh, "live")) setError(null);
      } catch (cause) {
        if (!aliveRef.current) return;
        const message = cause instanceof Error ? cause.message : "ADMIN_LOCAL_READ_UNAVAILABLE";
        if (message === "FORBIDDEN") {
          await cache.clearResource(activeScope);
          memory.delete(activeKey);
          setData(null);
          setSource(null);
        }
        setError(message);
        if (message === "UNAUTHORIZED") window.location.assign("/login");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
      if (!aliveRef.current) return;
      timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    };

    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    void start();
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyRecord, kind, period, refresh, resource, stableOptions, userId]);

  return { data, source, loading, refreshing, error, savedAt, refresh };
}
