export type AlertSeverity = 'critical' | 'high' | 'attention' | 'info';
export type AlertDomain = 'sales' | 'debt' | 'inventory' | 'delivery' | 'mcp';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type AdminAlert = {
  id: string;
  domain: AlertDomain;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  entity: string;
  ruleCode: string;
  ruleName: string;
  threshold: string;
  actual: string;
  source: 'Công Ty' | 'MCP';
  detectedAt: string;
  summary: string;
  recommendation: string;
  timeline: { time: string; title: string; note: string }[];
};

export const alertSeverityLabels: Record<AlertSeverity, string> = {
  critical: 'Nghiêm trọng',
  high: 'Cao',
  attention: 'Cần chú ý',
  info: 'Thông tin',
};

export const adminAlerts: AdminAlert[] = [
  { id:'debt-overdue-01', domain:'debt', severity:'critical', status:'active', title:'Công nợ quá hạn vượt ngưỡng', entity:'Khách hàng An Phát', ruleCode:'AR-OVERDUE-30', ruleName:'Nợ quá hạn trên 30 ngày', threshold:'≤ 30 ngày', actual:'47 ngày', source:'Công Ty', detectedAt:'17:18 hôm nay', summary:'Khoản phải thu đã vượt ngưỡng quản trị và cần được theo dõi ở cấp quản lý.', recommendation:'Rà soát hạn mức, lịch sử thanh toán và kế hoạch thu hồi trước quyết định tiếp theo.', timeline:[{time:'17:18',title:'Cảnh báo phát sinh',note:'Tuổi nợ ghi nhận 47 ngày.'},{time:'17:20',title:'Đưa vào trung tâm cảnh báo',note:'Mức độ được xếp Nghiêm trọng.'}] },
  { id:'margin-drop-01', domain:'sales', severity:'high', status:'active', title:'Biên lợi nhuận giảm bất thường', entity:'Nhóm sản phẩm nguyên liệu A', ruleCode:'GM-DROP-08', ruleName:'Biên lợi nhuận giảm trên 8%', threshold:'Giảm < 8%', actual:'Giảm 11,6%', source:'Công Ty', detectedAt:'16:42 hôm nay', summary:'Biên lợi nhuận kỳ hiện tại giảm mạnh so với kỳ so sánh.', recommendation:'Kiểm tra biến động giá vốn, chiết khấu và cơ cấu đơn hàng.', timeline:[{time:'16:42',title:'Quy tắc phát hiện',note:'Mức giảm 11,6%.'}] },
  { id:'inventory-low-01', domain:'inventory', severity:'high', status:'active', title:'Tồn kho thấp hơn mức an toàn', entity:'Kho Bình Tân · SKU HP-204', ruleCode:'INV-SAFETY-01', ruleName:'Tồn dưới mức an toàn', threshold:'≥ 120 đơn vị', actual:'64 đơn vị', source:'Công Ty', detectedAt:'15:55 hôm nay', summary:'Tồn khả dụng đã thấp hơn mức an toàn cấu hình cho mặt hàng.', recommendation:'Đối chiếu nhu cầu mở, lịch hàng về và khả năng điều chuyển.', timeline:[{time:'15:55',title:'Cảnh báo phát sinh',note:'Tồn khả dụng 64 đơn vị.'}] },
  { id:'delivery-fail-01', domain:'delivery', severity:'attention', status:'active', title:'Tỷ lệ giao thất bại tăng', entity:'Tuyến giao khu vực Tây', ruleCode:'DLV-FAIL-05', ruleName:'Tỷ lệ giao thất bại tăng trên 5%', threshold:'≤ 5%', actual:'7,8%', source:'Công Ty', detectedAt:'14:30 hôm nay', summary:'Tỷ lệ giao thất bại trong kỳ vượt ngưỡng theo dõi.', recommendation:'Rà soát nguyên nhân giao lại, địa chỉ và khung giờ thất bại.', timeline:[{time:'14:30',title:'Quy tắc phát hiện',note:'Tỷ lệ 7,8%.'}] },
  { id:'mcp-visit-01', domain:'mcp', severity:'attention', status:'active', title:'Tỷ lệ hoàn thành tuyến MCP thấp', entity:'Nhóm MCP khu vực Đông', ruleCode:'MCP-ROUTE-85', ruleName:'Hoàn thành tuyến dưới 85%', threshold:'≥ 85%', actual:'76%', source:'MCP', detectedAt:'13:10 hôm nay', summary:'Tỷ lệ hoàn thành tuyến trong ngày thấp hơn ngưỡng quản trị.', recommendation:'Kiểm tra khách chưa ghé, lý do bỏ tuyến và phân bổ công việc.', timeline:[{time:'13:10',title:'Cảnh báo phát sinh',note:'Hoàn thành tuyến 76%.'}] },
];

export const alertRulesPreview = [
  { code:'AR-OVERDUE-30', name:'Nợ quá hạn trên 30 ngày', domain:'Công nợ', severity:'Nghiêm trọng', condition:'Tuổi nợ > 30 ngày' },
  { code:'GM-DROP-08', name:'Biên lợi nhuận giảm trên 8%', domain:'Kinh doanh', severity:'Cao', condition:'Mức giảm > 8%' },
  { code:'INV-SAFETY-01', name:'Tồn dưới mức an toàn', domain:'Kho', severity:'Cao', condition:'Tồn khả dụng < mức an toàn' },
  { code:'DLV-FAIL-05', name:'Tỷ lệ giao thất bại tăng trên 5%', domain:'Giao vận', severity:'Cần chú ý', condition:'Tỷ lệ thất bại > 5%' },
  { code:'MCP-ROUTE-85', name:'Hoàn thành tuyến dưới 85%', domain:'MCP', severity:'Cần chú ý', condition:'Tỷ lệ hoàn thành < 85%' },
] as const;
