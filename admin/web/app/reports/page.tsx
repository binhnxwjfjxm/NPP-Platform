import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { reportDomainLabel, reportPreviews, type ReportDomain } from './report-preview-data';
import styles from './report-center.module.css';

const tabs=[
{key:'executive',label:'Điều hành',icon:'overview' as const},{key:'sales-profit',label:'Kinh doanh & lợi nhuận',icon:'tag' as const},{key:'debt',label:'Công nợ',icon:'coin' as const},{key:'inventory',label:'Kho',icon:'warehouse' as const},{key:'delivery-cod',label:'Giao vận & COD',icon:'truck' as const},{key:'mcp',label:'MCP / thị trường',icon:'mobile' as const},{key:'people',label:'Nhân sự / hiệu suất',icon:'user' as const},{key:'decisions',label:'Đề xuất & cảnh báo',icon:'document' as const},
];
const periods=['Hôm nay','7 ngày','Tháng này','Quý này'];

export default function ReportsPage({searchParams}:{searchParams?:{tab?:string;period?:string}}){
 const selected=tabs.some(t=>t.key===searchParams?.tab)?(searchParams?.tab as ReportDomain):'executive';
 const period=periods.includes(searchParams?.period??'')?searchParams?.period??'Tháng này':'Tháng này';
 const tabItems=tabs.map(t=>({href:t.key==='executive'?'/reports':`/reports?tab=${t.key}`,label:t.label,icon:t.icon,active:selected===t.key}));
 const item=reportPreviews.find(r=>r.domain===selected)??reportPreviews[0];
 return <AdminShell activeSection="reports" title="Báo cáo quản trị" subtitle="Theo dõi chỉ số, xu hướng và điểm cần chú ý từ Công Ty và MCP.">
  <AdminIconTabs label="Nhóm báo cáo quản trị" tabs={tabItems}/>
  <div className={styles.periodTabs} aria-label="Kỳ báo cáo">{periods.map(p=><Link key={p} className={`${styles.periodTab} ${period===p?styles.periodActive:''}`} href={`/reports?tab=${selected}&period=${encodeURIComponent(p)}`}>{p}</Link>)}</div>
  <p className="adminPreviewNotice">Dữ liệu minh họa để hoàn thiện giao diện báo cáo; chưa phải số liệu điều hành thực tế.</p>
  <section className={`card ${styles.hero}`}>
   <div className={styles.heroCopy}><span className={styles.eyebrow}>{reportDomainLabel[item.domain]} · {period}</span><h2>{item.title}</h2><p>{item.summary}</p></div>
   <div className={styles.comparison}><small>Kỳ hiện tại</small><strong>{item.current}</strong><span className={styles.delta}>{item.delta}</span><small>Kỳ trước</small><b>{item.previous}</b></div>
  </section>
  <section className={styles.kpiGrid} aria-label="Chỉ số quản trị">{item.metrics.map(metric=><div className={`card ${styles.kpi}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></div>)}</section>
  <section className={`card ${styles.trend}`}><div className={styles.sectionHeading}><div><span>Xu hướng kỳ</span><h3>Diễn biến nhanh</h3></div><strong>{item.delta}</strong></div><div className={styles.sparkBars} aria-label="Biểu đồ xu hướng minh họa">{[42,55,49,67,61,74,82].map((h,i)=><span key={i} style={{height:`${h}%`}}/> )}</div></section>
  <section className={`card ${styles.highlights}`}><div className={styles.sectionHeading}><div><span>Điểm cần chú ý</span><h3>Nhận định quản trị</h3></div></div>{item.highlights.map((h,i)=><div className={styles.highlightRow} key={h}><span>{i+1}</span><p>{h}</p></div>)}</section>
  <Link className={`card ${styles.detailLink}`} href={`/reports/${item.id}`}><span>Xem báo cáo chi tiết</span><strong>→</strong></Link>
 </AdminShell>;
}
