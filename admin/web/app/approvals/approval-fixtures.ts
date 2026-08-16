export type ApprovalDomain = 'commercial' | 'customer-debt' | 'operations' | 'mcp';
export type ApprovalState = 'pending' | 'needs-info' | 'approved' | 'rejected';
export type ApprovalPriority = 'critical' | 'high' | 'normal';

export type ApprovalItem = {
  id: string;
  domain: ApprovalDomain;
  title: string;
  source: 'Công Ty' | 'MCP';
  requester: string;
  entity: string;
  impact: string;
  reason: string;
  submittedAt: string;
  waitingAge: string;
  priority: ApprovalPriority;
  state: ApprovalState;
  rule: string;
  evidence: string[];
  history: Array<{ time: string; label: string; actor: string }>;
};

export const approvalFixtures: ApprovalItem[] = [
  {
    id: 'apv-price-001', domain: 'commercial', title: 'Đề xuất điều chỉnh giá vượt chính sách', source: 'Công Ty', requester: 'Nguyễn Văn An', entity: 'Đơn SO-2026-0811-024', impact: 'Giảm 6,0% so với giá chuẩn', reason: 'Khách hàng cam kết sản lượng tháng cao hơn kế hoạch.', submittedAt: '16:08 · 11/08/2026', waitingAge: '1 giờ 10 phút', priority: 'high', state: 'pending', rule: 'Vượt biên độ giá cho phép 3,0%', evidence: ['Giá chuẩn: 24.500 đ/kg', 'Giá đề xuất: 23.030 đ/kg', 'Sản lượng dự kiến: 18.000 kg'], history: [{ time: '16:08', label: 'Gửi đề xuất', actor: 'Nguyễn Văn An · Công Ty' }],
  },
  {
    id: 'apv-debt-002', domain: 'customer-debt', title: 'Đề xuất tăng hạn mức công nợ', source: 'Công Ty', requester: 'Trần Minh Khoa', entity: 'Công ty Minh Thành', impact: 'Tăng hạn mức thêm 180.000.000 đ', reason: 'Đơn hàng mới vượt hạn mức hiện tại nhưng khách thanh toán đúng lịch 6 tháng gần nhất.', submittedAt: '14:42 · 11/08/2026', waitingAge: '2 giờ 36 phút', priority: 'critical', state: 'pending', rule: 'Hạn mức sau điều chỉnh vượt ngưỡng quản lý', evidence: ['Hạn mức hiện tại: 500.000.000 đ', 'Dư nợ hiện tại: 462.000.000 đ', 'Nợ quá hạn: 0 đ'], history: [{ time: '14:42', label: 'Gửi đề xuất', actor: 'Trần Minh Khoa · Công Ty' }],
  },
  {
    id: 'apv-cod-004', domain: 'operations', title: 'Đề xuất xử lý chênh lệch COD vượt ngưỡng', source: 'Công Ty', requester: 'Phạm Quốc Huy', entity: 'Chuyến GH-0811-07', impact: 'Chênh lệch 2.450.000 đ', reason: 'Chênh lệch vượt ngưỡng xử lý thường ngày và cần quyết định cấp quản lý.', submittedAt: '12:15 · 11/08/2026', waitingAge: '5 giờ 03 phút', priority: 'critical', state: 'pending', rule: 'Chênh lệch COD vượt ngưỡng quản lý', evidence: ['COD phải thu: 48.700.000 đ', 'Đã bàn giao: 46.250.000 đ', 'Chênh lệch: 2.450.000 đ'], history: [{ time: '12:15', label: 'Gửi đề xuất', actor: 'Phạm Quốc Huy · Công Ty' }],
  },
  {
    id: 'apv-mcp-005', domain: 'mcp', title: 'Đề xuất hỗ trợ khách hàng trọng điểm', source: 'MCP', requester: 'Võ Thanh Tùng', entity: 'Đại lý Hoàng Gia', impact: 'Hỗ trợ trưng bày 12.000.000 đ', reason: 'Điểm bán có tiềm năng tăng sản lượng nhưng mức hỗ trợ vượt quyền MCP.', submittedAt: '10:32 · 11/08/2026', waitingAge: '6 giờ 46 phút', priority: 'normal', state: 'pending', rule: 'Mức hỗ trợ vượt thẩm quyền MCP', evidence: ['Sản lượng hiện tại: 7,2 tấn/tháng', 'Mục tiêu sau hỗ trợ: 10 tấn/tháng', 'Thời gian đề xuất: 3 tháng'], history: [{ time: '10:32', label: 'Gửi đề xuất', actor: 'Võ Thanh Tùng · MCP' }],
  },
  {
    id: 'apv-history-006', domain: 'commercial', title: 'Đề xuất chiết khấu hợp đồng quý III', source: 'Công Ty', requester: 'Nguyễn Văn An', entity: 'Khách hàng An Phúc', impact: 'Chiết khấu bổ sung 2,0%', reason: 'Cam kết doanh số theo quý.', submittedAt: '09:10 · 10/08/2026', waitingAge: 'Đã hoàn tất', priority: 'normal', state: 'approved', rule: 'Chiết khấu vượt thẩm quyền nhân viên kinh doanh', evidence: ['Doanh số cam kết: 1,8 tỷ đ/quý'], history: [{ time: '09:10 · 10/08', label: 'Gửi đề xuất', actor: 'Nguyễn Văn An · Công Ty' }, { time: '10:05 · 10/08', label: 'Đã đồng ý', actor: 'Quản lý' }],
  },
];

export const approvalDomainLabel: Record<ApprovalDomain, string> = {
  commercial: 'Thương mại',
  'customer-debt': 'Khách hàng & công nợ',
  operations: 'Ngoại lệ vận hành',
  mcp: 'MCP',
};

export const approvalStateLabel: Record<ApprovalState, string> = {
  pending: 'Chờ quyết định',
  'needs-info': 'Chờ bổ sung',
  approved: 'Đã đồng ý',
  rejected: 'Đã từ chối',
};
