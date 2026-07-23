const REPLACEMENTS: Array<[RegExp, string]> = [
  [/Từ route master\/report sync/gi, "Đồng bộ từ tuyến và báo cáo"],
  [/route master\/report sync/gi, "Đồng bộ từ tuyến và báo cáo"],
  [/route master/gi, "dữ liệu tuyến"],
  [/report sync/gi, "đồng bộ báo cáo"],
  [/opened by backend api/gi, "Phiên được mở từ hệ thống"],
  [/supabase live/gi, "Đang cập nhật"],
  [/customer_details/gi, "chi tiết điểm bán"],
  [/\bBC phiên\b/gi, "Báo cáo phiên"],
  [/\bBC\b/g, "Báo cáo"],
  [/\bsnapshot\b/gi, "báo cáo"],
  [/follow[- ]?up/gi, "việc theo dõi"],
  [/\btest sản phẩm\b/gi, "thử sản phẩm"],
  [/\btesst\b/gi, "thử"],
  [/\btest\b/gi, "thử sản phẩm"],
  [/\bhealth\b/gi, "mức đánh giá"],
  [/\bactive\b/gi, "đang hoạt động"],
  [/\blive\b/gi, "đang cập nhật"],
  [/\bapi\b/gi, "hệ thống"]
];

export function businessText(value: unknown, fallback = "") {
  let output = String(value ?? "").trim();
  if (!output) return fallback;
  for (const [pattern, replacement] of REPLACEMENTS) output = output.replace(pattern, replacement);
  return output.replace(/\s{2,}/g, " ").trim();
}

export function businessOwner(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || /^(sale|sales)$/i.test(raw)) return "Chưa phân công";
  return businessText(raw);
}

export function isTechnicalSourceText(value: unknown) {
  return /(supabase|backend|database|\bdb\b|nguồn dữ liệu|data source|source:|\bapi\b)/i.test(String(value ?? ""));
}
