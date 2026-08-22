const EARTH_RADIUS_METERS = 6_371_000;

export const ALERT_STATUSES = Object.freeze(['new', 'seen', 'handling', 'resolved']);
export const ALERT_TRANSITIONS = Object.freeze({ new: 'seen', seen: 'handling', handling: 'resolved' });
export const MCP_ALERT_RULES = Object.freeze([
  Object.freeze({ code: 'MCP_LOCATION_OUTSIDE_ACCURACY', domain: 'mcp', name: 'Check-in ngoài vùng sai số GPS', metric: 'Khoảng cách GPS', threshold: 'Khoảng cách lớn hơn tổng sai số của hai điểm GPS', severity: 'high' }),
  Object.freeze({ code: 'MCP_LOCATION_EVIDENCE_INCOMPLETE', domain: 'mcp', name: 'Bằng chứng vị trí chưa đủ', metric: 'GPS và độ chính xác', threshold: 'Thiếu tọa độ hoặc độ chính xác ở một trong hai phía', severity: 'attention' }),
  Object.freeze({ code: 'MCP_VISITED_WITHOUT_CHECKIN', domain: 'mcp', name: 'Đã ghé nhưng chưa có check-in', metric: 'Trạng thái ghé và check-in', threshold: 'Đã ghé nhưng chưa có check-in', severity: 'attention' }),
  Object.freeze({ code: 'MCP_CHECKIN_WITHOUT_ACTIVITY', domain: 'mcp', name: 'Check-in chưa có hoạt động liên kết', metric: 'Hoạt động sau check-in', threshold: 'Chưa có đơn, dùng thử, báo cáo, theo dõi hoặc lượt ghé liên kết', severity: 'attention' }),
]);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function radians(value) { return value * Math.PI / 180; }
function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function hasActivity(row) { return Boolean(row.order_id || row.test_id || row.report_id || Number(row.followup_count ?? 0) > 0 || row.has_visit === true); }
function alertId(code, sessionCustomerId) { return `mcp-${code.toLowerCase().replaceAll('_', '-')}-${text(sessionCustomerId)}`; }

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const phi1 = radians(lat1);
  const phi2 = radians(lat2);
  const dPhi = radians(lat2 - lat1);
  const dLambda = radians(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function assessLocation(row) {
  if (row.checked_in !== true) return Object.freeze({ status: 'not_checked_in', distanceMeters: null, uncertaintyMeters: null });
  const checkinLat = numberOrNull(row.checkin_lat);
  const checkinLng = numberOrNull(row.checkin_lng);
  const checkinAccuracy = numberOrNull(row.checkin_accuracy);
  const outletLat = numberOrNull(row.outlet_lat);
  const outletLng = numberOrNull(row.outlet_lng);
  const outletAccuracy = numberOrNull(row.outlet_accuracy);
  if ([checkinLat, checkinLng, checkinAccuracy, outletLat, outletLng, outletAccuracy].some((value) => value === null)) {
    return Object.freeze({ status: 'insufficient', distanceMeters: null, uncertaintyMeters: null });
  }
  const distanceMeters = haversineMeters(checkinLat, checkinLng, outletLat, outletLng);
  const uncertaintyMeters = Math.max(0, checkinAccuracy) + Math.max(0, outletAccuracy);
  return Object.freeze({ status: distanceMeters <= uncertaintyMeters ? 'consistent' : 'review', distanceMeters, uncertaintyMeters: Math.round(uncertaintyMeters) });
}

function anomaly(ruleCode, row, extra = {}) {
  const rule = MCP_ALERT_RULES.find((candidate) => candidate.code === ruleCode);
  return Object.freeze({
    id: alertId(ruleCode, row.session_customer_id), domain: 'mcp', ruleCode, ruleName: rule?.name ?? ruleCode, severity: rule?.severity ?? 'attention',
    title: rule?.name ?? 'Cảnh báo MCP', entity: text(row.customer_name, 'Điểm bán chưa có tên'), source: 'MCP',
    employeeName: text(row.employee_name, text(row.sales_label, 'Nhân viên chưa khớp hồ sơ')), employeeCode: text(row.employee_code, text(row.sales_label, '')),
    routeName: text(row.route_name, 'Chưa có tuyến'), sessionId: text(row.session_id), sessionCustomerId: text(row.session_customer_id), customerId: row.customer_id == null ? null : String(row.customer_id),
    detectedAt: row.checkin_at ?? row.session_date, threshold: rule?.threshold ?? '', actual: extra.actual ?? '', summary: extra.summary ?? '',
    recommendation: extra.recommendation ?? 'Rà soát dữ liệu nguồn và hoạt động liên quan trước khi kết luận.', evidence: Object.freeze(extra.evidence ?? []),
  });
}

export function buildMcpAnomalies(rows) {
  const alerts = [];
  for (const row of rows ?? []) {
    const location = assessLocation(row);
    if (row.visit_status === 'visited' && row.checked_in !== true) alerts.push(anomaly('MCP_VISITED_WITHOUT_CHECKIN', row, { actual: 'Đã ghé · chưa check-in', summary: 'Điểm bán được đánh dấu đã ghé nhưng chưa có check-in đi kèm.', evidence: ['Trạng thái ghé: Đã ghé', 'Check-in: Chưa có'] }));
    if (row.checked_in === true && location.status === 'insufficient') alerts.push(anomaly('MCP_LOCATION_EVIDENCE_INCOMPLETE', row, { actual: 'Thiếu tọa độ hoặc độ chính xác', summary: 'Check-in đã được ghi nhận nhưng dữ liệu vị trí chưa đủ để đối chiếu đáng tin cậy.', evidence: ['Có check-in', 'Thiếu một phần GPS/độ chính xác của điểm bán hoặc check-in'] }));
    if (location.status === 'review') alerts.push(anomaly('MCP_LOCATION_OUTSIDE_ACCURACY', row, { actual: `${location.distanceMeters} m · vùng sai số ${location.uncertaintyMeters} m`, summary: 'Khoảng cách giữa GPS check-in và GPS điểm bán lớn hơn tổng sai số được ghi nhận. Đây là tín hiệu cần kiểm tra, không phải kết luận cuối cùng.', recommendation: 'Đối chiếu thời gian, nguồn GPS, hoạt động tại điểm bán và bằng chứng liên quan trước khi kết luận.', evidence: [`Khoảng cách: ${location.distanceMeters} m`, `Tổng sai số GPS: ${location.uncertaintyMeters} m`] }));
    if (row.checked_in === true && !hasActivity(row)) alerts.push(anomaly('MCP_CHECKIN_WITHOUT_ACTIVITY', row, { actual: 'Có check-in · chưa có hoạt động liên kết', summary: 'Check-in đã có nhưng chưa thấy đơn, dùng thử, báo cáo, việc theo dõi hoặc lượt ghé liên kết.', evidence: ['Có check-in', 'Chưa có hoạt động nghiệp vụ liên kết'] }));
  }
  return Object.freeze(alerts);
}

export function hasLinkedActivity(row) { return hasActivity(row); }
export function canTransitionAlertStatus(currentStatus, nextStatus) { return ALERT_TRANSITIONS[currentStatus] === nextStatus; }
