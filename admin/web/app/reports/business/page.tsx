import Link from 'next/link';
import { AdminShell } from '../../admin-shell';
import { AdminFilterChip, AdminKpiCard, AdminKpiGrid, AdminStatePanel, AdminToolbar } from '../../admin-ui-primitives';
import { reportPeriods } from '../report-data';
import { loadBusinessReport, type BusinessBreakdownKey, type BusinessRow } from '../business-report-data';
import baseStyles from '../report-center.module.css';
import styles from './business-workspace.module.css';

const dimensions: Array<{ key: BusinessBreakdownKey; label: string }> = [
  { key: 'customers', label: 'Khách hàng' },
  { key: 'customerGroups', label: 'Loại khách' },
  { key: 'channels', label: 'Kênh bán' },
  { key: 'products', label: 'Sản phẩm' },
  { key: 'productGroups', label: 'Nhóm hàng' },
  { key: 'employees', label: 'Nhân viên bán hàng' },
];

function text(value: unknown, fallback = '0'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, currency: string): string {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number(value))} ${currency}`;
}

function quantity(value: unknown, unit: { code?: string; name?: string }): string {
  const label = unit.name || unit.code || 'ĐVT chưa xác định';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 }).format(number(value))} ${label}`;
}

function change(row: BusinessRow): string {
  if (row.changePercent !== null && row.changePercent !== '') {
    const parsed = Number(row.changePercent);
    if (Number.isFinite(parsed)) return `${parsed > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed)}%`;
  }
  if (row.comparisonState === 'new') return 'Mới phát sinh';
  if (row.comparisonState === 'inactive') return 'Không phát sinh kỳ này';
  return 'Chưa có cơ sở so sánh';
}

function changeTone(row: BusinessRow): 'up' | 'down' | 'neutral' {
  const parsed = Number(row.changePercent);
  if (!Number.isFinite(parsed) || parsed === 0) return 'neutral';
  return parsed > 0 ? 'up' : 'down';
}

function rowToken(row: BusinessRow, index: number): string {
  return [row.id || row.code || `row-${index}`, row.currencyCode, row.unit?.code || row.unit?.name || 'unit'].join('~');
}

function trendSeries(points: Record<string, unknown>[]) {
  const grouped = new Map<string, Array<{ date: string; value: number }>>();
  for (const point of points) {
    const currencyCode = text(point.currencyCode, 'VND');
    const rows = grouped.get(currencyCode) ?? [];
    rows.push({ date: text(point.businessDate), value: number(point.revenue ?? point.totalValue) });
    grouped.set(currencyCode, rows);
  }

  return Array.from(grouped.entries()).map(([currencyCode, rows]) => {
    const max = Math.max(1, ...rows.map((row) => row.value));
    const chartTop = 18;
    const chartBottom = 162;
    const width = 1000;
    const pointsString = rows.map((row, index) => {
      const x = rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width;
      const y = chartBottom - (row.value / max) * (chartBottom - chartTop);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return { currencyCode, rows, pointsString };
  });
}

export default async function BusinessReportPage({
  searchParams,
}: {
  searchParams?: { period?: string; view?: string; item?: string };
}) {
  const report = await loadBusinessReport(searchParams?.period);
  const requestedDimension = searchParams?.view;
  const selectedDimension = dimensions.some((item) => item.key === requestedDimension)
    ? requestedDimension as BusinessBreakdownKey
    : 'customers';
  const selectedDimensionLabel = dimensions.find((item) => item.key === selectedDimension)?.label ?? 'Khách hàng';

  const revenues = Array.isArray(report.summary.revenues) ? report.summary.revenues as Record<string, unknown>[] : [];
  const quantities = Array.isArray(report.summary.quantities) ? report.summary.quantities as Record<string, unknown>[] : [];
  const rows = report.breakdowns[selectedDimension] ?? [];
  const series = trendSeries(report.trend);

  const queryHref = (values: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value) query.set(key, value);
    }
    return `/reports/business?${query.toString()}`;
  };
  const periodHref = (period: string) => queryHref({ period, view: selectedDimension });
  const dimensionHref = (view: BusinessBreakdownKey) => queryHref({ period: report.period, view });
  const rowDetailHref = (row: BusinessRow, index: number) => queryHref({
    period: report.period,
    view: selectedDimension,
    item: rowToken(row, index),
  });
  const closeDetailHref = dimensionHref(selectedDimension);
  const selectedRowIndex = rows.findIndex((row, index) => rowToken(row, index) === searchParams?.item);
  const selectedRow = selectedRowIndex >= 0 ? rows[selectedRowIndex] : null;

  const exportHref = `/reports/export?${new URLSearchParams({ report: 'sales-profit', from: report.from, to: report.to }).toString()}`;
  const reconciliationHref = `/reports/business/reconciliation?${new URLSearchParams({ period: report.period }).toString()}`;
  const tone = report.state === 'ready' ? 'ok' : report.state === 'partial' ? 'partial' : report.state === 'forbidden' ? 'forbidden' : 'error';

  return (
    <AdminShell
      activeSection="reports"
      title="Báo cáo Kinh doanh"
      subtitle="Theo dõi doanh thu, sản lượng và cơ cấu bán hàng."
      contentWidth="wide"
    >
      <AdminToolbar
        label="Kỳ báo cáo"
        actions={
          <div className={styles.toolbarActions}>
            <Link className={styles.secondaryAction} href={reconciliationHref}>Đối soát</Link>
            <a className={baseStyles.toolbarAction} href={exportHref}>Xuất Excel</a>
          </div>
        }
      >
        {reportPeriods.map((period) => (
          <AdminFilterChip key={period} href={periodHref(period)} label={period} active={report.period === period} />
        ))}
      </AdminToolbar>

      {report.state === 'ready' ? (
        <div className={styles.dataStatus} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          <span>Số liệu đã đối soát</span>
        </div>
      ) : (
        <AdminStatePanel
          title={report.state === 'partial' ? 'Có dữ liệu lịch sử cần lưu ý' : 'Không thể tải số liệu'}
          message={report.message ?? 'Không thể tải Báo cáo Kinh doanh.'}
          tone={tone}
        />
      )}

      <AdminKpiGrid label="Tổng quan Kinh doanh" className={styles.kpis}>
        <AdminKpiCard
          label="Doanh thu"
          value={revenues.length ? revenues.map((row) => money(row.revenue, text(row.currencyCode, 'VND'))).join(' · ') : 'Không phát sinh'}
          note="Giữ riêng từng loại tiền."
        />
        <AdminKpiCard
          label="Sản lượng"
          value={quantities.length ? quantities.map((row) => quantity(row.quantity, (row.unit ?? {}) as { code?: string; name?: string })).join(' · ') : 'Không phát sinh'}
          note="Không cộng gộp các ĐVT khác nhau."
        />
        <AdminKpiCard label="Đơn đã chốt" value={text(report.summary.effectiveOrderCount)} note="Đơn xác nhận hoặc hoàn tất." />
        <AdminKpiCard label="Khách mua" value={text(report.summary.buyerCount)} note="Khách có đơn hiệu lực." />
      </AdminKpiGrid>

      <section className={`card ${styles.trendPanel}`} aria-labelledby="business-trend-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Xu hướng</span>
            <h2 id="business-trend-title">Doanh thu theo ngày</h2>
          </div>
        </div>
        {series.length ? (
          <div className={styles.trendSeries}>
            {series.map((item) => (
              <figure className={styles.trendFigure} key={item.currencyCode}>
                <div className={styles.trendMeta}>
                  <strong>{item.currencyCode}</strong>
                  <span>{item.rows.length} ngày có dữ liệu</span>
                </div>
                <svg className={styles.trendChart} viewBox="0 0 1000 180" role="img" aria-label={`Doanh thu theo ngày - ${item.currencyCode}`}>
                  <line x1="0" y1="162" x2="1000" y2="162" className={styles.chartAxis} />
                  <line x1="0" y1="90" x2="1000" y2="90" className={styles.chartGrid} />
                  <line x1="0" y1="18" x2="1000" y2="18" className={styles.chartGrid} />
                  <polyline points={item.pointsString} className={styles.chartLine} />
                </svg>
                <figcaption>
                  <span>{item.rows[0]?.date}</span>
                  <span>{item.rows[item.rows.length - 1]?.date}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className={styles.emptyText}>Không phát sinh doanh thu trong kỳ.</p>
        )}
      </section>

      <section className={`card ${styles.analysisPanel}`} aria-labelledby="business-analysis-title">
        <div className={styles.analysisHeader}>
          <div>
            <span>Phân tích</span>
            <h2 id="business-analysis-title">Xem theo {selectedDimensionLabel.toLowerCase()}</h2>
          </div>
          <Link className={styles.profitLink} href="/reports/profit">Xem Lợi nhuận</Link>
        </div>

        <nav className={styles.dimensionTabs} role="tablist" aria-label="Chiều phân tích Báo cáo Kinh doanh">
          {dimensions.map((item) => (
            <Link
              key={item.key}
              className={item.key === selectedDimension ? styles.activeTab : styles.dimensionTab}
              href={dimensionHref(item.key)}
              role="tab"
              aria-selected={item.key === selectedDimension}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={`${styles.analysisLayout} ${selectedRow ? styles.withDetail : ''}`}>
          {rows.length ? (
            <>
              <div className={styles.desktopTableWrap}>
                <table className={styles.analysisTable}>
                  <thead>
                    <tr>
                      <th>Tên</th>
                      <th>Doanh thu</th>
                      <th>Sản lượng</th>
                      <th>Tỷ trọng</th>
                      <th>Kỳ trước</th>
                      <th>Thay đổi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const toneClass = changeTone(row) === 'up' ? styles.changeUp : changeTone(row) === 'down' ? styles.changeDown : styles.changeNeutral;
                      const selected = selectedRowIndex === index;
                      return (
                        <tr key={rowToken(row, index)} className={selected ? styles.selectedRow : undefined}>
                          <td>
                            <Link className={styles.rowLink} href={rowDetailHref(row, index)}>
                              <strong>{row.name || 'Chưa có tên'}</strong>
                              {row.code ? <small>{row.code}</small> : null}
                            </Link>
                          </td>
                          <td>{money(row.revenue, row.currencyCode)}</td>
                          <td>{quantity(row.quantity, row.unit)}</td>
                          <td>{text(row.sharePercent)}%</td>
                          <td>
                            <strong>{money(row.previousRevenue, row.currencyCode)}</strong>
                            <small>{quantity(row.previousQuantity, row.unit)}</small>
                          </td>
                          <td><span className={`${styles.changeBadge} ${toneClass}`}>{change(row)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.mobileList} aria-label={`${selectedDimensionLabel} trên điện thoại`}>
                {rows.map((row, index) => (
                  <details className={styles.mobileRowGroup} key={`mobile-${rowToken(row, index)}`}>
                    <summary className={styles.mobileRow}>
                      <span className={styles.mobileRowCopy}>
                        <strong>{row.name || 'Chưa có tên'}</strong>
                        <small>{row.code ? `${row.code} · ` : ''}{quantity(row.quantity, row.unit)}</small>
                      </span>
                      <span className={styles.mobileRowAside}>
                        <strong>{money(row.revenue, row.currencyCode)}</strong>
                        <span className={styles.mobileRowChevron} aria-hidden="true">›</span>
                      </span>
                    </summary>
                    <div className={styles.mobileDetail}>
                      <dl className={styles.mobileDetailList}>
                        <div><dt>Tỷ trọng</dt><dd>{text(row.sharePercent)}%</dd></div>
                        <div><dt>Kỳ trước</dt><dd>{money(row.previousRevenue, row.currencyCode)} · {quantity(row.previousQuantity, row.unit)}</dd></div>
                        <div><dt>Thay đổi</dt><dd>{change(row)}</dd></div>
                      </dl>
                      {row.source === 'legacy-current-master' ? (
                        <p className={styles.legacyNote}>Đơn cũ đang tham chiếu danh mục hiện tại.</p>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.emptyText}>Không phát sinh dữ liệu trong mục này.</p>
          )}

          {selectedRow ? (
            <aside className={styles.detailPanel} aria-label={`Chi tiết ${selectedRow.name}`}>
              <div className={styles.detailHeader}>
                <div>
                  <span>Chi tiết</span>
                  <h3>{selectedRow.name || 'Chưa có tên'}</h3>
                  {selectedRow.code ? <small>{selectedRow.code}</small> : null}
                </div>
                <Link href={closeDetailHref} className={styles.closeDetail} aria-label="Đóng chi tiết">×</Link>
              </div>
              <dl className={styles.detailList}>
                <div><dt>Doanh thu</dt><dd>{money(selectedRow.revenue, selectedRow.currencyCode)}</dd></div>
                <div><dt>Sản lượng</dt><dd>{quantity(selectedRow.quantity, selectedRow.unit)}</dd></div>
                <div><dt>Tỷ trọng</dt><dd>{text(selectedRow.sharePercent)}%</dd></div>
                <div><dt>Kỳ trước</dt><dd>{money(selectedRow.previousRevenue, selectedRow.currencyCode)}</dd></div>
                <div><dt>Thay đổi</dt><dd>{change(selectedRow)}</dd></div>
              </dl>
              {selectedRow.source === 'legacy-current-master' ? (
                <p className={styles.legacyNote}>Đơn cũ đang tham chiếu danh mục hiện tại.</p>
              ) : null}
            </aside>
          ) : null}
        </div>
      </section>

      {report.warnings.length ? (
        <>
          <section className={`card ${styles.warningPanel} ${styles.warningDesktop}`}>
            <strong>Điểm cần lưu ý</strong>
            <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </section>
          <details className={`card ${styles.warningPanel} ${styles.warningMobile}`}>
            <summary>
              <span>Có {report.warnings.length} điểm cần lưu ý</span>
              <span aria-hidden="true">›</span>
            </summary>
            <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </details>
        </>
      ) : null}
    </AdminShell>
  );
}
