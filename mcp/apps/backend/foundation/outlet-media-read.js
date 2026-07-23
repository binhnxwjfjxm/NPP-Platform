import { supabaseRest } from "./supabase-adapter.js";
import { presignR2Get } from "./r2-storage.js";

const VIEW_URL_TTL_SECONDS = 300;

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function number(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireR2(config) {
  if (!config.r2?.configured) fail("r2_not_configured", 503);
  return config.r2;
}

function customerProfile(row) {
  return {
    id: text(row.id),
    routeId: text(row.route_id),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name) || "Điểm bán",
    phone: text(row.phone),
    area: text(row.area),
    address: text(row.address),
    sortOrder: number(row.sort_order),
    active: row.active !== false,
    note: text(row.note),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    geo: number(row.geo_lat) !== null && number(row.geo_lng) !== null ? {
      lat: number(row.geo_lat),
      lng: number(row.geo_lng),
      accuracy: number(row.geo_accuracy),
      capturedAt: text(row.geo_captured_at),
      source: text(row.geo_source)
    } : null,
    googleMapsUrl: text(row.google_maps_url),
    syncStatus: text(row.sync_status)
  };
}

function mediaProfile(row, r2) {
  const objectKey = text(row.object_key);
  if (!objectKey) fail("outlet_media_object_key_missing", 500);
  const signed = presignR2Get(r2, objectKey, { expiresSeconds: VIEW_URL_TTL_SECONDS });
  return {
    id: text(row.id),
    sessionId: text(row.session_id),
    mediaType: text(row.media_type) || "storefront",
    mimeType: text(row.mime_type),
    byteSize: number(row.actual_byte_size),
    width: number(row.width),
    height: number(row.height),
    status: text(row.status),
    capturedBy: text(row.captured_by),
    capturedAt: text(row.captured_at),
    geo: number(row.geo_lat) !== null && number(row.geo_lng) !== null ? {
      lat: number(row.geo_lat),
      lng: number(row.geo_lng),
      accuracy: number(row.geo_accuracy)
    } : null,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    viewUrl: signed.getUrl,
    viewExpiresAt: signed.expiresAt
  };
}

export async function loadOutletCustomerProfile(routeCustomerId, context, config, { fetchImpl = fetch } = {}) {
  const id = text(routeCustomerId);
  if (!id) fail("route_customer_id_required");

  const customerQuery = [
    "mcp_route_customers?select=id,route_id,customer_id,customer_name,phone,area,address,sort_order,active,note,created_at,updated_at,geo_lat,geo_lng,geo_accuracy,geo_captured_at,geo_source,google_maps_url,sync_status",
    `id=eq.${encodeURIComponent(id)}`,
    "limit=1"
  ].join("&");
  const customer = rows(await supabaseRest(config, customerQuery, { fetchImpl }))[0] || null;
  if (!customer) fail("route_customer_not_found", 404);

  const mediaQuery = [
    "mcp_outlet_media?select=id,session_id,object_key,media_type,mime_type,actual_byte_size,width,height,status,captured_by,captured_at,geo_lat,geo_lng,geo_accuracy,created_at,updated_at",
    `installation_id=eq.${encodeURIComponent(context.installation.id)}`,
    `route_customer_id=eq.${encodeURIComponent(id)}`,
    "status=eq.ready",
    "order=captured_at.desc",
    "limit=3"
  ].join("&");
  const mediaRows = rows(await supabaseRest(config, mediaQuery, { fetchImpl }));
  const r2 = mediaRows.length ? requireR2(config) : null;

  return {
    customer: customerProfile(customer),
    media: mediaRows.map((row) => mediaProfile(row, r2)),
    mediaLimit: 3,
    mediaCount: mediaRows.length
  };
}
