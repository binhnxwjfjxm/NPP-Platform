const BUSINESS_ERROR_RULES: Array<{ match: string[]; message: string }> = [
  { match: ["route_active_session_ambiguous", "active_session_ambiguous", "nhiều hơn một phiên hoạt động"], message: "Tuyến đang có nhiều phiên cùng mở. Hãy vào Quản lý phiên để chốt hoặc hủy các phiên cũ, rồi thử lại." },
  { match: ["route_active_session_exists", "active_session_exists"], message: "Tuyến đang có một phiên khác chưa chốt. Hãy vào Quản lý phiên để chốt hoặc hủy phiên cũ trước khi mở phiên mới." },
  { match: ["session_not_found", "route_not_found", "session_customer_not_found", "no_data_found"], message: "Dữ liệu không còn tồn tại. Vui lòng tải lại trang." },
  { match: ["session_has_activity", "session_has_activity_cancel_instead"], message: "Phiên đã có hoạt động nên không thể xóa. Hãy hủy phiên để giữ lại lịch sử." },
  { match: ["session_closed", "session_closed_read_only", "read_only"], message: "Phiên đã chốt và không thể chỉnh sửa." },
  { match: ["route_inactive"], message: "Tuyến đang tạm dừng nên chưa thể mở phiên." },
  { match: ["required", "invalid_"], message: "Thông tin chưa đầy đủ hoặc chưa hợp lệ. Vui lòng kiểm tra lại." },
  { match: ["missing_supabase", "missing_backend", "missing_config", "supabase_", "backend_unavailable", "fetch failed", "failed_5"], message: "Hệ thống tạm thời chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ quản trị." },
  { match: ["duplicate key", "already exists"], message: "Dữ liệu này đã tồn tại. Vui lòng kiểm tra lại." }
];

export function userFacingError(error: unknown, fallback = "Không thể hoàn tất thao tác. Vui lòng thử lại.") {
  const raw = error instanceof Error ? error.message : String(error || "");
  const normalized = raw.toLowerCase();
  const matched = BUSINESS_ERROR_RULES.find((rule) => rule.match.some((token) => normalized.includes(token)));
  return matched?.message || fallback;
}
