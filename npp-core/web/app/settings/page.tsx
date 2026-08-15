import Link from 'next/link';
import { AppShell } from '../components/app-shell-core';
export const dynamic = 'force-dynamic';
export default function SettingsPage(){return <AppShell title="Cài đặt" subtitle="Các thiết lập vận hành và quản trị hệ thống."><div style={{maxWidth:920,margin:'0 auto'}}><Link href="/settings/data-backup" style={{display:'block',padding:20,border:'1px solid #e5e7eb',borderRadius:16,textDecoration:'none',color:'inherit',background:'#fff'}}><strong style={{display:'block',fontSize:18}}>Dữ liệu &amp; sao lưu</strong><span style={{display:'block',marginTop:8,color:'#6b7280'}}>Sao lưu toàn bộ, tải bản backup và xác minh yêu cầu xóa dữ liệu.</span></Link></div></AppShell>}
