"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";

const DirectionsContext = createContext<Map<string, string>>(new Map());

function googleMapsDirectionsUrl(lat: number, lng: number) {
  const destination = `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

function googleMapsSearchUrl(customerName: string, area?: string | null) {
  const query = [customerName, area].map((value) => String(value || "").trim()).filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function McpRouteDirectionsProvider({
  routeCustomersData,
  children
}: {
  routeCustomersData: RouteCustomersData;
  children: ReactNode;
}) {
  const directionsByRouteCustomerId = useMemo(() => {
    const result = new Map<string, string>();
    routeCustomersData.customers.forEach((customer) => {
      if (!customer.id || !customer.gps) return;
      result.set(customer.id, googleMapsDirectionsUrl(customer.gps.lat, customer.gps.lng));
    });
    return result;
  }, [routeCustomersData]);

  return (
    <DirectionsContext.Provider value={directionsByRouteCustomerId}>
      {children}
    </DirectionsContext.Provider>
  );
}

export function useMcpCustomerDirections(
  routeCustomerId: string | null | undefined,
  customerName: string,
  area?: string | null
) {
  const directionsByRouteCustomerId = useContext(DirectionsContext);
  const exactUrl = routeCustomerId ? directionsByRouteCustomerId.get(routeCustomerId) : null;
  return {
    url: exactUrl || googleMapsSearchUrl(customerName, area),
    exact: Boolean(exactUrl)
  };
}
