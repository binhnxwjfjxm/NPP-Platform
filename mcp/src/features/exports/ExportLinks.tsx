export type ExportLink = {
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: "primary";
  hint?: string;
};

export type ExportGroup = {
  title: string;
  links: ExportLink[];
};

export const MCP_EXCEL_LINKS: ExportLink[] = [
  { label: "Danh sách điểm bán", href: "/api/backend/exports/route-customers.csv", tone: "primary", hint: "Tên, địa chỉ, vị trí và liên kết bản đồ" },
  { label: "Chi tiết phiên bán hàng", href: "/api/backend/exports/mcp-sessions.csv", hint: "Điểm bán, kết quả ghé và phát sinh trong phiên" },
  { label: "Danh sách đơn hàng", href: "/api/backend/exports/orders.csv?view=orders", hint: "Một dòng cho mỗi đơn, không lặp thông tin khách hàng theo sản phẩm" },
  { label: "Chi tiết sản phẩm theo đơn", href: "/api/backend/exports/orders.csv?view=items", hint: "Mỗi dòng là một sản phẩm và dùng mã đơn để đối chiếu" },
  { label: "Ghi nhận thị trường", href: "/api/backend/exports/market-reports.csv", hint: "Đối thủ, sản phẩm đang dùng, nhu cầu và cơ hội" },
  { label: "Việc cần theo dõi", href: "/api/backend/exports/followups.csv", hint: "Việc cần làm, ngày hẹn và người phụ trách" },
  { label: "Kết quả thử sản phẩm", href: "/api/backend/exports/tests.csv", hint: "Sản phẩm đã thử và kết quả theo điểm bán" }
];

export const MCP_PDF_LINKS: ExportLink[] = [
  { label: "Báo cáo điều hành", href: "/api/pdf/dashboard", tone: "primary", hint: "Mở báo cáo tổng hợp để đọc, in hoặc lưu PDF" },
  { label: "Báo cáo thị trường", href: "/api/pdf/market-report", hint: "Mở báo cáo cơ hội bán hàng để đọc, in hoặc lưu PDF" }
];

function groupsFromLinks(excelLinks: ExportLink[], pdfLinks: ExportLink[]) {
  const groups: ExportGroup[] = [];
  if (excelLinks.length) groups.push({ title: "Dữ liệu Excel / CSV", links: excelLinks });
  if (pdfLinks.length) groups.push({ title: "Báo cáo để đọc và in", links: pdfLinks });
  return groups;
}

function readerGroupTitle(title: string) {
  if (title === "Xuất văn phòng") return "Báo cáo để đọc và gửi";
  if (title === "Dữ liệu báo cáo") return "Dữ liệu chuyên sâu";
  return title;
}

function readerLink(item: ExportLink): ExportLink {
  if (item.label === "PDF") return { ...item, label: "Bản in / PDF", hint: "Mở bản báo cáo hoàn chỉnh để đọc, in hoặc lưu PDF" };
  if (item.label === "Excel") return { ...item, label: "Bảng chi tiết Excel / CSV", hint: "Dùng để lọc, đối chiếu và tổng hợp số liệu" };
  if (item.label === "Word") return { ...item, label: "Báo cáo Word", hint: "Bản báo cáo có thể chỉnh sửa trước khi gửi" };
  if (item.label === "Xuất dữ liệu") return { ...item, label: "Dữ liệu phân tích", hint: "Dành cho tích hợp hoặc phân tích nâng cao" };
  if (item.label === "Xuất văn bản") return { ...item, label: "Bản nội dung thuần", hint: "Nội dung báo cáo gọn để lưu trữ hoặc xử lý tiếp" };
  return item;
}

export function ExportMenu({ label = "Xuất file", excelLinks = MCP_EXCEL_LINKS, pdfLinks = MCP_PDF_LINKS, groups, primary = false }: { label?: string; excelLinks?: ExportLink[]; pdfLinks?: ExportLink[]; groups?: ExportGroup[]; primary?: boolean }) {
  const items = groups || groupsFromLinks(excelLinks, pdfLinks);
  const quickAction = items.flatMap((group) => group.links).find((item) => item.onClick);
  const emphasized = primary || label === "Chọn loại file";

  return <>
    <details className="export-menu">
      <summary className={emphasized ? "button primary export-menu-trigger" : "button export-menu-trigger"}>{label} ▾</summary>
      <div className="export-menu-panel">
        {items.map((group) => <div className="export-menu-group" key={group.title}>
          <strong>{readerGroupTitle(group.title)}</strong>
          {group.links.map(readerLink).map((item) => {
            const className = item.tone === "primary" ? "export-menu-link primary" : "export-menu-link";
            const content = <><span>{item.label}</span>{item.hint ? <small>{item.hint}</small> : null}</>;
            if (item.onClick) {
              return <button
                className={className}
                key={item.label}
                type="button"
                style={{ width: "100%", textAlign: "left" }}
                onClick={(event) => {
                  item.onClick?.();
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                {content}
              </button>;
            }
            return <a className={className} key={item.href || item.label} href={item.href || "#"} target="_blank" rel="noreferrer">
              {content}
            </a>;
          })}
        </div>)}
      </div>
    </details>
    {quickAction ? <button className="button" type="button" onClick={() => quickAction.onClick?.()}>Xuất theo bộ lọc</button> : null}
  </>;
}

export function ExportLinksPanel({ title = "Xuất file", subtitle = "Tải dữ liệu để đối chiếu hoặc mở báo cáo để in và lưu PDF.", excelLinks = MCP_EXCEL_LINKS, pdfLinks = MCP_PDF_LINKS }: { title?: string; subtitle?: string; excelLinks?: ExportLink[]; pdfLinks?: ExportLink[] }) {
  return <section className="card" style={{ marginBottom: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div><strong>{title}</strong><p className="page-subtitle" style={{ margin: "4px 0 0" }}>{subtitle}</p></div>
      <ExportMenu label="Chọn file cần xuất" excelLinks={excelLinks} pdfLinks={pdfLinks} primary />
    </div>
  </section>;
}

export function buildExportLink(label: string, href: string, tone?: "primary", hint?: string): ExportLink {
  return { label, href, tone, hint };
}
