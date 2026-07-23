type Cell = string | number | boolean | null | undefined;

const STATUS_LABELS: Record<string, string> = {
  draft: "Nháp",
  confirmed: "Đã chốt",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
  pending: "Chờ xử lý",
  visited: "Đã ghé",
  skipped: "Bỏ qua",
  opened: "Đang thực hiện",
  active: "Đang thực hiện",
  done: "Đã hoàn tất",
  completed: "Đã hoàn tất",
  open: "Chưa xử lý",
  todo: "Chưa xử lý",
  doing: "Đang xử lý",
  in_progress: "Đang xử lý",
  blocked: "Đang vướng",
  normal: "Theo dõi",
  opportunity: "Tốt",
  risk: "Cần xử lý",
  good: "Tốt",
  watch: "Cần theo dõi",
  interested: "Quan tâm",
  tested: "Đã thử",
  ok: "Đạt",
  sample: "Đã nhận mẫu",
  follow: "Cần theo dõi",
  retry: "Cần thử lại",
  bad: "Chưa phù hợp"
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp"
};

const SOURCE_LABELS: Record<string, string> = {
  orders_tab: "Tạo tại màn Đơn",
  mcp_session_customer: "Phát sinh trong phiên bán hàng",
  session: "Phát sinh trong phiên bán hàng",
  phone: "Điện thoại",
  manual: "Nhập trực tiếp",
  order: "Đơn hàng",
  added: "Bổ sung trong phiên",
  planned: "Theo kế hoạch tuyến"
};

function text(value: Cell) {
  return String(value ?? "").trim();
}

export function reportStatus(value: Cell, fallback = "Chưa xác định") {
  const raw = text(value);
  if (!raw) return fallback;
  return STATUS_LABELS[raw.toLowerCase()] || raw.replace(/_/g, " ");
}

export function reportPriority(value: Cell) {
  const raw = text(value);
  if (!raw) return "Trung bình";
  return PRIORITY_LABELS[raw.toLowerCase()] || raw.replace(/_/g, " ");
}

export function reportSource(value: Cell) {
  const raw = text(value);
  if (!raw) return "Chưa xác định";
  return SOURCE_LABELS[raw.toLowerCase()] || raw.replace(/_/g, " ");
}

export function reportYesNo(value: Cell) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true" ? "Có" : "Không";
}

export function reportDate(value: Cell) {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "-";
}

export function reportDateTime(value: Cell) {
  const raw = text(value);
  if (!raw) return "-";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString("vi-VN");
}

export function reportMoney(value: Cell) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `${Math.round(amount).toLocaleString("vi-VN")} đ` : "0 đ";
}

export function reportSlug(value: Cell, fallback = "bao-cao") {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ĐÐ]/g, "D")
    .replace(/đ/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
}

export function reportFilename(prefix: string, parts: Cell[], extension: string) {
  const suffix = parts.map((part) => reportSlug(part, "")).filter(Boolean).join("-");
  return `${reportSlug(prefix)}${suffix ? `-${suffix}` : ""}.${extension.replace(/^\./, "")}`;
}

export function reportErrorMessage(value: unknown, fallback = "Không thể tạo báo cáo lúc này.") {
  const code = String(value ?? "").trim();
  const messages: Record<string, string> = {
    session_id_required: "Chưa chọn phiên bán hàng cần xuất báo cáo.",
    session_report_source_required: "Chưa chọn phiên bán hàng cần xuất báo cáo.",
    missing_mcp_session_context: "Không xác định được phiên bán hàng cần xuất.",
    order_not_found: "Không tìm thấy đơn hàng cần xuất.",
    unsupported_session_report_export_format: "Định dạng báo cáo này chưa được hỗ trợ."
  };
  return messages[code] || fallback;
}
