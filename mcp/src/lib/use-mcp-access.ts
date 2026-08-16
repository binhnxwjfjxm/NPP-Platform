"use client";

import { useEffect, useMemo, useState } from "react";
import { isMcpInstallationOwner } from "./mcp-auth";

type AccessPayload = Readonly<{
  roles?: readonly string[];
  permissions?: readonly string[];
}>;

type AccessState = Readonly<{
  loaded: boolean;
  roles: readonly string[];
  permissions: readonly string[];
}>;

let cachedAccess: AccessState | null = null;
let accessRequest: Promise<AccessState> | null = null;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))].sort()
    : [];
}

async function loadAccess(): Promise<AccessState> {
  if (cachedAccess) return cachedAccess;
  if (!accessRequest) {
    accessRequest = fetch("/api/auth/me", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return { loaded: true, roles: [], permissions: [] };
        const payload = await response.json().catch(() => null) as { data?: AccessPayload } | null;
        return {
          loaded: true,
          roles: stringList(payload?.data?.roles),
          permissions: stringList(payload?.data?.permissions)
        };
      })
      .catch(() => ({ loaded: true, roles: [], permissions: [] }))
      .then((state) => {
        cachedAccess = state;
        return state;
      });
  }
  return accessRequest;
}

export function useMcpAccess() {
  const [state, setState] = useState<AccessState>(() => cachedAccess || { loaded: false, roles: [], permissions: [] });

  useEffect(() => {
    let active = true;
    void loadAccess().then((next) => { if (active) setState(next); });
    return () => { active = false; };
  }, []);

  return useMemo(() => {
    const permissionSet = new Set(state.permissions);
    const owner = isMcpInstallationOwner({ roles: [...state.roles] } as { roles: string[] });
    return {
      loaded: state.loaded,
      roles: state.roles,
      permissions: state.permissions,
      isOwner: owner,
      hasPermission(permission: string) {
        return owner || permissionSet.has(String(permission || "").trim().toLowerCase());
      }
    };
  }, [state]);
}
