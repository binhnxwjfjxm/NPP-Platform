import 'server-only';

import Link from 'next/link';
import { CoreApiError, requestCore } from '../../lib/core-api';
import { resolveReportRange, type ReportPeriod } from './report-data';
import styles from './report-center.module.css';

type Row = Record<string, unknown>;
type View = 'overview' | 'people' | 'routes' | 'visited' | 'anomalies';

function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function text(row: Row, key: string, fallback = 'Chưa có dữ liệu') { const value = row[key]; return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : fallback; }
function bool(row: Row, key: string) { return row[key] === true; }
function locationLabel(value: string) { return value === 'consistent' ? 'Phù hợp vùng sai số GPS' : value === 'review' ? 'Cần kiểm tra vị trí' : value === 'insufficient' ? 'Chưa đủ bằng chứng vị trí' : 'Chưa check-in'; }

async function load(period: ReportPeriod): Promise<{ data: Row | null; message: string | null }> {
  const range = resolveReportRange(period);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  try {
    const value = await requestCore<unknown>(`/api/reporting/mcp-supervision?${query.toString()}`);
    return value && typeof value === 'object' && !Array.isArray(value) ? { data: value as Row, message: null } : { data: null, message: 'Dữ liệu giám sát chưa sẵn sàng.' };
  } catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 403) return { data: null, message: 'Tài khoản hiện tại không có quyền xem giám sát MCP.' };
    return { data: null, message: 'Không thể tải giám sát MCP ở thời điểm hiện tại.' };
  }
}

export async function McpSupervision({ period, viewInput }: { period: ReportPeriod; viewInput?: string }) {
  const view: View = ['overview','people','routes','visited','anomalies'].includes(String(viewInput)) ? viewInput as View : 'overview';
  const result = await load(period);
  const data = result.data ?? {};
  const summary = (data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary) ? data.summary : {}) as Row;
  const actors = rows(data.fieldActors);
  const routes = rows(data.routes);
  const outlets = rows(data.outlets);
  const anomalies = rows(data.anomalies);
  const tabs: Array<[View,string]> = [['overview','Tổng quan'],['people','Nhân viên'],['routes','Tuyến'],['visited','Khách đã ghé'],['anomalies','Bất thường']];
  const href = (candidate: View) => `?period=${encodeURIComponent(period)}&view=${candidate}`;
  return <section className={`card ${styles.detailSection}`}>
    <h3>Giám sát MCP</h3>
    <nav className={styles.periodTabs} aria-label="Giám sát MCP">{tabs.map(([key,label])=><Link className={`${styles.periodTab} ${view===key?styles.periodActive:''}`} href={href(key)} key={key}>{label}</Link>)}</nav>
    {result.message ? <div className={styles.detailNote}>{result.message}</div> : null}
    {result.data && view === 'overview' ? <div className={styles.detailRows}><div><span>Nhân viên</span><strong>{text(summary,'employeeCount','0')}</strong></div><div><span>Tuyến</span><strong>{text(summary,'routeCount','0')}</strong></div><div><span>Phiên đi tuyến</span><strong>{text(summary,'sessionCount','0')}</strong></div><div><span>Điểm đã ghé</span><strong>{text(summary,'visitedOutletCount','0')}</strong></div><div><span>Check-in</span><strong>{text(summary,'checkinCount','0')}</strong></div><div><span>Vị trí cần kiểm tra</span><strong>{text(summary,'reviewLocationCount','0')}</strong></div><div><span>Bất thường</span><strong>{text(summary,'anomalyCount','0')}</strong></div></div> : null}
    {result.data && view === 'people' ? <div className={styles.detailRows}>{actors.map((row,index)=><div key={`${text(row,'employeeId',String(index))}-${index}`}><span>{text(row,'employeeName',text(row,'salesLabel','Nhân viên'))}</span><strong>{text(row,'visitedOutletCount','0')} điểm đã ghé · {text(row,'sessionCount','0')} phiên</strong></div>)}</div> : null}
    {result.data && view === 'routes' ? <div className={styles.detailRows}>{routes.map((row,index)=><div key={`${text(row,'routeId',String(index))}-${index}`}><span>{text(row,'routeName','Tuyến')}</span><strong>{text(row,'visitedOutletCount','0')} điểm đã ghé · {text(row,'sessionCount','0')} phiên</strong></div>)}</div> : null}
    {result.data && view === 'visited' ? <div className={styles.detailRows}>{outlets.filter((row)=>text(row,'visitStatus','')==='visited').map((row,index)=><div key={`${text(row,'sessionCustomerId',String(index))}-${index}`}><span>{text(row,'customerName','Điểm bán')}</span><strong>{bool(row,'checkedIn')?'Đã check-in':'Chưa check-in'} · {locationLabel(text(row,'locationStatus','not_checked_in'))}{text(row,'distanceMeters','') ? ` · ${text(row,'distanceMeters')} m` : ''}</strong></div>)}</div> : null}
    {result.data && view === 'anomalies' ? <div className={styles.detailHighlights}>{anomalies.length ? anomalies.map((row,index)=><div key={`${text(row,'id',String(index))}-${index}`}><strong>{text(row,'title','Cần kiểm tra')}</strong><br/>{text(row,'entity','Điểm bán')} · {text(row,'actual','')}</div>) : <div>Không phát hiện bất thường MCP trong kỳ đang xem.</div>}</div> : null}
  </section>;
}
