"use client";

import Link from "next/link";
import { AdminIconTabs } from "../admin-icon-tabs";
import {
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  type AdminStatusTone,
} from "../admin-ui-primitives";
import { useAdminLocalRead } from "../local-read/use-admin-local-read";
import type { ProposalItem } from "./proposal-data";

const tabDefs = [
  { key: "all", label: "Tất cả", icon: "check" as const },
  { key: "commercial", label: "Thương mại", icon: "tag" as const },
  { key: "customer-debt", label: "Khách hàng & công nợ", icon: "user" as const },
  { key: "operations", label: "Ngoại lệ vận hành", icon: "exception" as const },
  { key: "mcp", label: "MCP", icon: "mobile" as const },
  { key: "history", label: "Lịch sử", icon: "clipboard" as const },
];

const proposalDomainLabel: Record<ProposalItem["domain"], string> = {
  commercial: "Thương mại",
  "customer-debt": "Khách hàng & công nợ",
  operations: "Ngoại lệ vận hành",
  mcp: "MCP",
};

const proposalStateLabel: Record<ProposalItem["status"], string> = {
  pending: "Chờ quyết định",
  "needs-info": "Chờ bổ sung",
  approved: "Đã đồng ý",
  rejected: "Đã từ chối",
};

const proposalSourceLabel: Record<ProposalItem["source"], string> = {
  company: "Công Ty",
  mcp: "MCP",
};

function priorityLabel(priority: string) {
  if (priority === "critical") return "Ưu tiên cao";
  if (priority === "high") return "Cần xử lý sớm";
  return "Bình thường";
}

function priorityTone(priority: string): AdminStatusTone {
  if (priority === "critical") return "danger";
  if (priority === "high") return "attention";
  return "neutral";
}

function proposalTone(status: ProposalItem["status"]): AdminStatusTone {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "needs-info") return "info";
  return "attention";
}

function matchesTab(item: ProposalItem, selected: string) {
  if (selected === "all") return item.status !== "approved" && item.status !== "rejected";
  if (selected === "history") return item.status === "approved" || item.status === "rejected";
  return item.domain === selected;
}

function proposalWaitingAge(item: ProposalItem, now = Date.now()): string {
  if (item.status === "approved" || item.status === "rejected") return "Đã hoàn tất";
  const started = Date.parse(item.updatedAt);
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

function loadMessage(error: string | null) {
  if (error === "FORBIDDEN") return "Tài khoản hiện tại không có quyền xem đề xuất quản trị.";
  return "Không thể tải danh sách đề xuất ở thời điểm hiện tại.";
}

export function ApprovalsLocal({ selected }: { selected: string }) {
  const read = useAdminLocalRead<ProposalItem[]>("proposals");
  const proposals = read.data;
  const tabs = tabDefs.map((tab) => ({
    href: tab.key === "all" ? "/approvals" : `/approvals?tab=${tab.key}`,
    label: tab.label,
    icon: tab.icon,
    active: selected === tab.key,
    badge: tab.key === "all" && proposals ? String(proposals.filter((item) => item.status === "pending").length) : undefined,
  }));
  const items = proposals?.filter((item) => matchesTab(item, selected)) ?? [];
  const selectedLabel = tabDefs.find((tab) => tab.key === selected)?.label ?? "Tất cả";

  return (
    <>
      <AdminIconTabs label="Nhóm đề xuất" tabs={tabs} />

      {read.error && proposals ? (
        <AdminStatePanel title="Đang dùng dữ liệu đã lưu" message="Lần cập nhật gần nhất chưa thành công. Hệ thống sẽ tự thử lại khi kết nối ổn định." tone="partial" icon="info" />
      ) : null}

      {read.loading && !proposals ? (
        <AdminStatePanel title="Đang tải đề xuất" message="Dữ liệu đã lưu sẽ được hiển thị trước nếu có trên thiết bị này." tone="partial" icon="info" />
      ) : proposals ? (
        <AdminKpiGrid label="Tóm tắt đề xuất">
          <AdminKpiCard label="Chờ quyết định" value={proposals.filter((item) => item.status === "pending").length} note="Đang chờ xem xét" icon="check" />
          <AdminKpiCard label="Chờ bổ sung" value={proposals.filter((item) => item.status === "needs-info").length} note="Cần thêm thông tin" icon="info" />
          <AdminKpiCard label="Ưu tiên cao" value={proposals.filter((item) => item.priority === "critical" && item.status === "pending").length} note="Cần chú ý trước" icon="exception" tone="attention" />
          <AdminKpiCard label="Trong nhóm" value={items.length} note={selectedLabel} icon="document" />
        </AdminKpiGrid>
      ) : (
        <AdminStatePanel
          title={loadMessage(read.error)}
          message="Vui lòng thử lại sau."
          tone={read.error === "FORBIDDEN" ? "forbidden" : "error"}
          icon="info"
        />
      )}

      {proposals ? (
        <section className="approvalList" aria-label="Danh sách đề xuất">
          {items.length ? items.map((item) => (
            <Link key={item.id} className="card approvalListItem" href={`/approvals/${item.id}`}>
              <div className="approvalListTopline">
                <AdminStatusBadge tone={priorityTone(item.priority)}>{priorityLabel(item.priority)}</AdminStatusBadge>
                <AdminStatusBadge tone={proposalTone(item.status)}>{proposalStateLabel[item.status]}</AdminStatusBadge>
              </div>
              <h2>{item.title}</h2>
              {item.entityLabel ? <p className="approvalEntity">{item.entityLabel}</p> : null}
              <div className="approvalMetaGrid">
                <span><small>Nguồn</small><strong>{proposalSourceLabel[item.source]}</strong></span>
                <span><small>Người gửi</small><strong>{item.requesterName}</strong></span>
                {item.impact ? <span><small>Tác động</small><strong>{item.impact}</strong></span> : null}
                <span><small>Thời gian chờ</small><strong>{proposalWaitingAge(item)}</strong></span>
              </div>
              {item.reason ? <p className="approvalReason">{item.reason}</p> : null}
              <span className="approvalOpenLabel">Xem chi tiết · {proposalDomainLabel[item.domain]}</span>
            </Link>
          )) : (
            <AdminStatePanel title="Không có đề xuất trong nhóm này." message="Chọn nhóm khác để tiếp tục." tone="empty" />
          )}
        </section>
      ) : null}
    </>
  );
}
