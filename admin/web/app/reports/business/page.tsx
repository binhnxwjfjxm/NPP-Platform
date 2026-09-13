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

function decimalText(value: unknown, maxFractionDigits = 6): string {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized || '0';
  const [, sign, integer, fraction = ''] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, '');
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

function money(value: unknown, currency: string): string {
  return `${decimalText(value, 2)} ${currency}`;
}

function quantity(value: unknown, unit: { code?: string; name?: string }): string {
  const label = unit.name || unit.code || 'ĐVT chưa xác định';
  return `${decimalText(value, 6)} ${label}`;
}

function percentText(value: unknown): string {
  return `${decimalText(value, 2)}%`;
}

function metricLabel(dimension: BusinessBreakdownKey): string {
  if (dimension === 'products') return 'Sản lượng';
  if (dimension === 'customers') return 'Số đơn';
  if (dimension === 'productGroups') return 'Số sản phẩm';
  return 'Hoạt động';
}

function metric(row: BusinessRow, dimension: BusinessBreakdownKey): string {
  const documents = text(row.documentCount);
  const customers = text(row.customerCount);
  const products = text(row.productCount);
  if (dimension === 'products') return quantity(row.quantity, row.unit);
  if (dimension === 'customers') return `${documents} đơn`;
  if (dimension === 'customerGroups') return `${customers} khách · ${documents} đơn`;
  if (dimension === 'channels') return `${documents} đơn · ${customers} khách`;
  if (dimension === 'productGroups') return `${products} sản phẩm`;
  return `${documents} đơn · ${customers} khách`;
}

function rowName(row: BusinessRow, dimension: BusinessBreakdownKey): string {
  const name = String(row.name ?? '').trim();
  if (row.source === 'total') return name || 'Tổng';
  if ((dimension === 'customerGroups' || dimension === 'productGroups') && (!row.id || name === 'Không xác định')) return 'Chưa phân loại';
  return name || 'Chưa có tên';
}

function previousValue(row: BusinessRow, dimension: BusinessBreakdownKey): string {
  const revenue = money(row.previousRevenue, row.currencyCode);
  return dimension === 'products' ? `${revenue} · ${quantity(row.previousQuantity, row.unit)}` : revenue;
}

function change(row: BusinessRow): string {
  const normalized = String(row.changePercent ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const nonZero = !/^-?0+(?:\.0+)?$/.test(normalized);
    const prefix = nonZero && !normalized.startsWith('-') ? '+' : '';
    return `${prefix}${percentText(normalized)}`;
  }
  if (row.comparisonState === 'new') return 'Mới phát sinh';
  if (row.comparisonState === 'inactive') return 'Không phát sinh kỳ này';
  return 'Chưa có cơ sở so sánh';
}

function changeTone(row: BusinessRow): 'up' | 'down' | 'neutral' {
  const normalized = String(row.changePercent ?? '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized) || /^-?0+(?:\.0+)?$/.test(normalized)) return 'neutral';
  return normalized.startsWith('-') ? 'down' : 'up';
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
  searchParams?: {
    period?: string;
    view?: string;
    item?: string;
    productGroupId?: string;
    customerGroupId?: string;
    includeZeroProducts?: string;
  };
}) {
  const report = await loadBusinessReport(searchParams?.period, {
    productGroupId: searchParams?.productGroupId,
    customerGroupId: searchParams?.customerGroupId,
    includeZeroProducts: searchParams?.includeZeroProducts,
  });
  const requestedDimension = searchParams?.view;
  const selectedDimension = dimensions.some((item) => item.key === requestedDimension)
    ? requestedDimension as BusinessBreakdownKey
    : 'customers';
  const selectedDimensionLabel = dimensions.find((item) => item.key === selectedDimension)?.label ?? 'Khách hàng';

  const revenues = Array.isArray(report.summary.revenues) ? report.summary.revenues as Record<string, unknown>[] : [];
  const rows = report.breakdowns[selectedDimension] ?? [];
  const series = trendSeries(report.trend);
  const productGroupOptions = report.classification.options.productGroups;
  const customerGroupOptions = report.classification.options.customerGroups;
  const totals = report.breakdownTotals[selectedDimension] ?? [];

  const queryHref = (values: Record<string, string | undefined>, keepContext = true) => {
    const query = new URLSearchParams();
    const targetView = (values.view ?? selectedDimension) as BusinessBreakdownKey;
    if (keepContext && targetView === 'customers' && report.filters.customerGroupId) {
      query.set('customerGroupId', report.filters.customerGroupId);
    }
    if (keepContext && targetView === 'products') {
      if (report.filters.productGroupId) query.set('productGroupId', report.filters.productGroupId);
      if (report.filters.includeZeroProducts) query.set('includeZeroProducts', 'true');
    }
    for (const [key, value] of Object.entries(values)) {
      if (value) query.set(key, value);
      else query.delete(key);
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

  const exportQuery = new URLSearchParams({ report: 'sales-profit', from: report.from, to: report.to });
  if (selectedDimension === 'customers' && report.filters.customerGroupId) {
    exportQuery.set('customerGroupId', report.filters.customerGroupId);
  }
  if (selectedDimension === 'products') {
    if (report.filters.productGroupId) exportQuery.set('productGroupId', report.filters.productGroupId);
    if (report.filters.includeZeroProducts) exportQuery.set('includeZeroProducts', 'true');
  }
  const exportHref = `/reports/export?${exportQuery.toString()}`;
  const reconciliationHref = `/reports/business/reconciliation?${new URLSearchParams({ period: report.period }).toString()}`;
  const tone = report.state === 'ready' ? 'ok' : report.state === 'partial' ? 'partial' : report.state === 'forbidden' ? 'forbidden' : 'error';

  return (
    <AdminShell
      activeSection="reports"
      title="Báo cáo Kinh doanh"
      subtitle="Theo dõi doanh thu, đơn hàng, khách mua và sản lượng theo từng sản phẩm."
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
          label="Mặt hàng đã bán"
          value={text(report.summary.soldProductCount)}
          note="Sản lượng xem theo từng sản phẩm để không cộng gộp sai ĐVT."
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

        {selectedDimension === 'customers' ? (
          <form className={styles.dimensionFilters} method="get" action="/reports/business" aria-label="Lọc khách hàng theo nhóm">
            <input type="hidden" name="period" value={report.period} />
            <input type="hidden" name="view" value="customers" />
            <label>
              <span>Nhóm khách hàng</span>
              <select name="customerGroupId" defaultValue={report.filters.customerGroupId ?? ''}>
                <option value="">Tất cả nhóm khách hàng</option>
                {customerGroupOptions.map((group) => (
                  <option key={group.id} value={group.id}>{[group.code, group.name].filter(Boolean).join(' — ')}</option>
                ))}
              </select>
            </label>
            <div className={styles.dimensionFilterActions}>
              <Link href={queryHref({ period: report.period, view: 'customers' }, false)}>Xóa lọc</Link>
              <button type="submit">Lọc khách hàng</button>
            </div>
          </form>
        ) : null}

        {selectedDimension === 'products' ? (
          <form className={styles.dimensionFilters} method="get" action="/reports/business" aria-label="Lọc sản phẩm theo nhóm">
            <input type="hidden" name="period" value={report.period} />
            <input type="hidden" name="view" value="products" />
            <label>
              <span>Nhóm sản phẩm</span>
              <select name="productGroupId" defaultValue={report.filters.productGroupId ?? ''}>
                <option value="">Tất cả nhóm sản phẩm</option>
                {productGroupOptions.map((group) => (
                  <option key={group.id} value={group.id}>{[group.code, group.name].filter(Boolean).join(' — ')}</option>
                ))}
              </select>
            </label>
            <label className={styles.zeroProducts}>
              <input type="checkbox" name="includeZeroProducts" value="true" defaultChecked={report.filters.includeZeroProducts} />
              <span>Hiện sản phẩm không phát sinh</span>
            </label>
            <div className={styles.dimensionFilterActions}>
              <Link href={queryHref({ period: report.period, view: 'products' }, false)}>Xóa lọc</Link>
              <button type="submit">Lọc sản phẩm</button>
            </div>
          </form>
        ) : null}

        <div className={`${styles.analysisLayout} ${selectedRow ? styles.withDetail : ''}`}>
          {rows.length ? (
            <>
              <div className={styles.desktopTableWrap}>
                <table className={styles.analysisTable}>
                  <thead>
                    <tr>
                      <th>Tên</th>
                      <th>Doanh thu</th>
                      <th>{metricLabel(selectedDimension)}</th>
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
                              <strong>{rowName(row, selectedDimension)}</strong>
                              {row.code ? <small>{row.code}</small> : null}
                            </Link>
                          </td>
                          <td>{money(row.revenue, row.currencyCode)}</td>
                          <td>{metric(row, selectedDimension)}</td>
                          <td>{percentText(row.sharePercent)}</td>
                          <td>
                            <strong>{money(row.previousRevenue, row.currencyCode)}</strong>
                            {selectedDimension === 'products' ? <small>{quantity(row.previousQuantity, row.unit)}</small> : null}
                          </td>
                          <td><span className={`${styles.changeBadge} ${toneClass}`}>{change(row)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totals.length ? (
                    <tfoot>
                      {totals.map((row, index) => (
                        <tr className={styles.totalRow} key={`total-${rowToken(row, index)}`}>
                          <td><strong>{rowName(row, selectedDimension)}</strong><small>{row.currencyCode}</small></td>
                          <td><strong>{money(row.revenue, row.currencyCode)}</strong></td>
                          <td><strong>{metric(row, selectedDimension)}</strong></td>
                          <td>{percentText(row.sharePercent)}</td>
                          <td><strong>{money(row.previousRevenue, row.currencyCode)}</strong>{selectedDimension === 'products' ? <small>{quantity(row.previousQuantity, row.unit)}</small> : null}</td>
                          <td><span className={styles.changeBadge}>{change(row)}</span></td>
                        </tr>
                      ))}
                    </tfoot>
                  ) : null}
                </table>
              </div>

              <div className={styles.mobileList} aria-label={`${selectedDimensionLabel} trên điện thoại`}>
                {rows.map((row, index) => (
                  <details className={styles.mobileRowGroup} key={`mobile-${rowToken(row, index)}`}>
                    <summary className={styles.mobileRow}>
                      <span className={styles.mobileRowCopy}>
                        <strong>{rowName(row, selectedDimension)}</strong>
                        <small>{[row.code, metric(row, selectedDimension)].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className={styles.mobileRowAside}>
                        <strong>{money(row.revenue, row.currencyCode)}</strong>
                        <span className={styles.mobileRowChevron} aria-hidden="true">›</span>
                      </span>
                    </summary>
                    <div className={styles.mobileDetail}>
                      <dl className={styles.mobileDetailList}>
                        <div><dt>{metricLabel(selectedDimension)}</dt><dd>{metric(row, selectedDimension)}</dd></div>
                        <div><dt>Tỷ trọng</dt><dd>{percentText(row.sharePercent)}</dd></div>
                        <div><dt>Kỳ trước</dt><dd>{previousValue(row, selectedDimension)}</dd></div>
                        <div><dt>Thay đổi</dt><dd>{change(row)}</dd></div>
                      </dl>
                      {row.source === 'legacy-current-master' ? (
                        <p className={styles.legacyNote}>Đơn cũ đang tham chiếu danh mục hiện tại.</p>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
              {totals.length ? (
                <div className={styles.mobileTotals} aria-label="Tổng báo cáo">
                  {totals.map((row, index) => (
                    <div key={`mobile-total-${rowToken(row, index)}`}>
                      <strong>{rowName(row, selectedDimension)}</strong>
                      <span>{money(row.revenue, row.currencyCode)} · {metric(row, selectedDimension)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.emptyText}>Không phát sinh dữ liệu trong mục này.</p>
          )}

          {selectedRow ? (
            <aside className={styles.detailPanel} aria-label={`Chi tiết ${rowName(selectedRow, selectedDimension)}`}>
              <div className={styles.detailHeader}>
                <div>
                  <span>Chi tiết</span>
                  <h3>{rowName(selectedRow, selectedDimension)}</h3>
                  {selectedRow.code ? <small>{selectedRow.code}</small> : null}
                </div>
                <Link href={closeDetailHref} className={styles.closeDetail} aria-label="Đóng chi tiết">×</Link>
              </div>
              <dl className={styles.detailList}>
                <div><dt>Doanh thu</dt><dd>{money(selectedRow.revenue, selectedRow.currencyCode)}</dd></div>
                <div><dt>{metricLabel(selectedDimension)}</dt><dd>{metric(selectedRow, selectedDimension)}</dd></div>
                <div><dt>Tỷ trọng</dt><dd>{percentText(selectedRow.sharePercent)}</dd></div>
                <div><dt>Kỳ trước</dt><dd>{previousValue(selectedRow, selectedDimension)}</dd></div>
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
