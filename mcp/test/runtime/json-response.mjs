export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function readJsonValue(response, label) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid_json_http_${response.status}`);
  }
}
