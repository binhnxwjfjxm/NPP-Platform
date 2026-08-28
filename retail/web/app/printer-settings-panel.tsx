'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PRINTER_SETTINGS,
  buildPrinterTestPayload,
  discoverPrinters,
  forgetNativePrinter,
  getPrinterCapabilities,
  savePrinterSettings,
  testDirectPrinter,
  type PrinterBridgeCapabilities,
  type PrinterPaper,
  type PrinterProfile,
  type PrinterSettings,
} from '../lib/printer-bridge';

type Props = {
  initialSettings: PrinterSettings;
  onSaved(settings: PrinterSettings): void;
  onClose(): void;
  onNotice(message: string): void;
  onError(message: string): void;
};

const defaultCapabilities: PrinterBridgeCapabilities = {
  version: 'web',
  directWifi: false,
  discovery: false,
  manualIp: false,
  protocols: ['SYSTEM'],
  cashDrawer: false,
};

function isThermalPaper(paper: PrinterPaper) {
  return paper === '80mm' || paper === '58mm';
}

function systemPaper(paper: PrinterPaper): PrinterPaper {
  return isThermalPaper(paper) ? 'A4' : paper;
}

function paperCss(paper: PrinterPaper) {
  const size = paper === '80mm' ? '80mm 120mm' : paper === '58mm' ? '58mm 100mm' : paper;
  return `@page { size: ${size}; margin: ${paper === '80mm' || paper === '58mm' ? '4mm' : '10mm'}; }`;
}

function paperClass(paper: PrinterPaper) {
  return paper === '80mm' ? '80' : paper === '58mm' ? '58' : paper.toLowerCase();
}

function systemPrintTest(paper: PrinterPaper) {
  const testScreen = document.createElement('section');
  testScreen.className = `print-screen printer-test-screen paper-${paperClass(paper)}`;
  testScreen.setAttribute('aria-hidden', 'true');
  testScreen.innerHTML = `<article class="print-document printer-test-document"><header><p>BÁN TẠI QUẦY</p><h1>PHIẾU IN THỬ</h1><p>Kiểm tra khổ giấy và máy in</p><small>${paper}</small></header><div class="printer-test-body"><strong>In thử thành công khi phiếu này ra đúng khổ.</strong><span>Khổ giấy: ${paper}</span><span>${new Date().toLocaleString('vi-VN')}</span></div></article>`;
  document.body.appendChild(testScreen);

  const style = document.createElement('style');
  style.dataset.retailPrintPage = 'true';
  style.textContent = paperCss(paper);
  document.head.appendChild(style);

  let cleaned = false;
  let fallbackTimer = 0;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('afterprint', cleanup);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    style.remove();
    testScreen.remove();
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  fallbackTimer = window.setTimeout(cleanup, 120000);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => window.print());
  });
}

function manualProfile(host: string, port: number, paper: PrinterPaper): PrinterProfile | null {
  const cleanHost = host.trim();
  if (!cleanHost) return null;
  return {
    id: `manual:${cleanHost}:${port}`,
    name: cleanHost,
    connectionType: 'LAN',
    protocol: 'ESC_POS',
    host: cleanHost,
    port,
    paper,
    lastVerifiedStatus: 'UNKNOWN',
  };
}

export function PrinterSettingsPanel({ initialSettings, onSaved, onClose, onNotice, onError }: Props) {
  const [draft, setDraft] = useState<PrinterSettings>(initialSettings ?? DEFAULT_PRINTER_SETTINGS);
  const [capabilities, setCapabilities] = useState<PrinterBridgeCapabilities>(defaultCapabilities);
  const [checkingBridge, setCheckingBridge] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [found, setFound] = useState<PrinterProfile[]>([]);
  const [host, setHost] = useState(initialSettings.profile?.host ?? '');
  const [port, setPort] = useState(initialSettings.profile?.port ?? 9100);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initialSettings.profile?.host));

  useEffect(() => {
    setDraft(initialSettings);
    setHost(initialSettings.profile?.host ?? '');
    setPort(initialSettings.profile?.port ?? 9100);
  }, [initialSettings]);

  useEffect(() => {
    let cancelled = false;
    setCheckingBridge(true);
    void getPrinterCapabilities().then((next) => {
      if (cancelled) return;
      setCapabilities(next);
      if (!next.directWifi) {
        setDraft((current) => ({
          ...current,
          method: 'SYSTEM',
          paper: systemPaper(current.paper),
        }));
      }
    }).catch(() => {
      if (cancelled) return;
      setCapabilities(defaultCapabilities);
      setDraft((current) => ({
        ...current,
        method: 'SYSTEM',
        paper: systemPaper(current.paper),
      }));
    }).finally(() => {
      if (!cancelled) setCheckingBridge(false);
    });
    return () => { cancelled = true; };
  }, []);

  const directReady = capabilities.directWifi;
  const selectedProfile = useMemo(() => {
    const manual = manualProfile(host, port, draft.paper);
    if (manual) return manual;
    return draft.profile ? { ...draft.profile, paper: draft.paper } : null;
  }, [draft.paper, draft.profile, host, port]);

  function chooseDirectMethod() {
    onError('');
    if (!directReady) {
      onNotice('Bản Retail đang mở là bản web. In Wi‑Fi trực tiếp và khổ giấy nhiệt 80/58 mm dùng trên Retail Mobile; trên bản này hãy dùng In bằng hệ thống.');
      return;
    }
    setDraft((current) => ({
      ...current,
      method: 'DIRECT_WIFI',
      paper: current.paper === 'A4' || current.paper === 'A5' ? '80mm' : current.paper,
    }));
  }

  async function findPrinters() {
    setDiscovering(true);
    onError('');
    try {
      const rows = await discoverPrinters();
      setFound(rows);
      if (!rows.length) onNotice('Chưa tìm thấy máy in. Có thể nhập địa chỉ trong Cài đặt nâng cao.');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Chưa thể tìm máy in.');
    } finally {
      setDiscovering(false);
    }
  }

  function choosePrinter(profile: PrinterProfile) {
    const next = { ...profile, paper: draft.paper, lastVerifiedStatus: 'UNKNOWN' as const };
    setDraft((current) => ({ ...current, method: 'DIRECT_WIFI', profile: next }));
    setHost('');
    setPort(next.port ?? 9100);
  }

  function useManualHost(value: string) {
    setHost(value);
    if (value.trim()) setDraft((current) => ({ ...current, method: 'DIRECT_WIFI', profile: null }));
  }

  async function testPrinter() {
    onError('');
    if (draft.method === 'SYSTEM') {
      systemPrintTest(draft.paper);
      onNotice('Đã mở giao diện in của thiết bị. Khổ giấy thực tế trong cửa sổ này do máy in/AirPrint cung cấp.');
      return;
    }
    if (!directReady) {
      onError('Thiết bị này chưa có bộ phận in Wi‑Fi trực tiếp. Hãy dùng In bằng hệ thống.');
      return;
    }
    if (!selectedProfile) {
      onError('Hãy chọn máy in hoặc nhập địa chỉ máy in trước khi In thử.');
      return;
    }
    if (draft.paper === 'A4' || draft.paper === 'A5') {
      onError('In Wi‑Fi trực tiếp hiện dành cho máy in nhiệt 80 mm hoặc 58 mm. Hãy đổi khổ giấy hoặc dùng In bằng hệ thống.');
      return;
    }
    setTesting(true);
    try {
      const result = await testDirectPrinter(selectedProfile, buildPrinterTestPayload(draft.paper, 1));
      const verifiedAt = result?.verifiedAt ?? new Date().toISOString();
      const verified = { ...selectedProfile, lastVerifiedAt: verifiedAt, lastVerifiedStatus: 'READY' as const };
      setDraft((current) => ({ ...current, profile: verified }));
      setHost(verified.host ?? '');
      onNotice('Máy in đã sẵn sàng.');
    } catch (reason) {
      setDraft((current) => ({ ...current, profile: selectedProfile ? { ...selectedProfile, lastVerifiedStatus: 'OFFLINE' } : current.profile }));
      onError(reason instanceof Error ? reason.message : 'Không kết nối được máy in.');
    } finally {
      setTesting(false);
    }
  }

  async function forgetPrinter() {
    try {
      await forgetNativePrinter(draft.profile);
    } catch {
      // Local profile must remain forgettable even if the printer is offline.
    }
    setDraft((current) => ({ ...current, profile: null }));
    setFound([]);
    setHost('');
    setPort(9100);
    onNotice('Đã quên máy in trên thiết bị này.');
  }

  function save() {
    onError('');
    if (draft.method === 'DIRECT_WIFI' && !directReady) {
      onError('Thiết bị này chưa hỗ trợ in Wi‑Fi trực tiếp. Hãy chọn In bằng hệ thống.');
      return;
    }
    if (draft.method === 'DIRECT_WIFI' && (draft.paper === 'A4' || draft.paper === 'A5')) {
      onError('In Wi‑Fi trực tiếp hiện dành cho khổ 80 mm hoặc 58 mm.');
      return;
    }
    const profile = draft.method === 'DIRECT_WIFI' ? selectedProfile : draft.profile;
    if (draft.method === 'DIRECT_WIFI' && !profile) {
      onError('Hãy chọn máy in hoặc nhập địa chỉ máy in.');
      return;
    }
    const normalized = savePrinterSettings({
      ...draft,
      paper: draft.method === 'SYSTEM' ? systemPaper(draft.paper) : draft.paper,
      profile: profile ? { ...profile, paper: draft.paper } : null,
    });
    onSaved(normalized);
  }

  const status = draft.method === 'SYSTEM'
    ? 'Sẵn sàng dùng máy in của thiết bị'
    : draft.profile?.lastVerifiedStatus === 'READY'
      ? 'Đã sẵn sàng'
      : draft.profile?.lastVerifiedStatus === 'OFFLINE'
        ? 'Chưa kết nối'
        : draft.profile || host.trim()
          ? 'Chưa kiểm tra'
          : 'Chưa chọn máy in';

  return <div className="printer-settings">
    <section className="printer-setting-section">
      <header><strong>Phương thức in mặc định</strong><small>Chọn cách nhân viên dùng hằng ngày.</small></header>
      <div className="printer-methods" role="radiogroup" aria-label="Phương thức in mặc định">
        <button type="button" role="radio" aria-checked={draft.method === 'DIRECT_WIFI'} aria-disabled={!directReady} className={`${draft.method === 'DIRECT_WIFI' ? 'active ' : ''}${!directReady ? 'unavailable' : ''}`.trim()} onClick={chooseDirectMethod}><span>Wi‑Fi</span><strong>In Wi‑Fi trực tiếp</strong><small>{checkingBridge ? 'Đang kiểm tra thiết bị…' : directReady ? 'In thẳng tới máy đã lưu' : 'Chạm để xem yêu cầu sử dụng'}</small></button>
        <button type="button" role="radio" aria-checked={draft.method === 'SYSTEM'} className={draft.method === 'SYSTEM' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, method: 'SYSTEM', paper: systemPaper(current.paper) }))}><span>↗</span><strong>In bằng hệ thống</strong><small>AirPrint hoặc máy in đã cài trên điện thoại</small></button>
      </div>
      {!checkingBridge && !directReady ? <p className="settings-help printer-system-note">Bản web không thể kết nối thẳng máy in nhiệt bằng địa chỉ IP. Muốn dùng máy 80/58 mm qua Wi‑Fi/LAN, mở Retail Mobile; bản web dùng cửa sổ in của iPhone.</p> : null}
    </section>

    {draft.method === 'DIRECT_WIFI' ? <section className="printer-setting-section">
      <header><strong>Máy in Wi‑Fi/LAN</strong><small>Điện thoại và máy in cần ở cùng mạng.</small></header>
      {draft.profile ? <div className="selected-printer"><span className={`printer-status ${draft.profile.lastVerifiedStatus === 'READY' ? 'ready' : ''}`} aria-hidden="true">●</span><div><strong>{draft.profile.name}</strong><small>{status}</small></div><button type="button" className="text-action" onClick={() => void forgetPrinter()}>Quên máy</button></div> : <p className="printer-empty">{host.trim() ? `Địa chỉ đang nhập: ${host.trim()}` : 'Chưa có máy in mặc định.'}</p>}
      <button className="secondary-action printer-discover" type="button" disabled={!capabilities.discovery || discovering} onClick={() => void findPrinters()}>{discovering ? 'Đang tìm máy in…' : 'Tìm máy in'}</button>
      {found.length ? <div className="printer-results" aria-label="Máy in tìm thấy">{found.map((profile) => <button type="button" className={draft.profile?.id === profile.id ? 'selected' : ''} key={profile.id} onClick={() => choosePrinter(profile)}><span>▣</span><span><strong>{profile.name}</strong><small>{profile.lastVerifiedStatus === 'READY' ? 'Đã sẵn sàng' : 'Chạm để chọn'}</small></span><b aria-hidden="true">›</b></button>)}</div> : null}
      <button className="advanced-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>Cài đặt nâng cao <span aria-hidden="true">{advancedOpen ? '⌃' : '⌄'}</span></button>
      {advancedOpen ? <div className="printer-advanced"><label>Địa chỉ máy in<input inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="Ví dụ: 192.168.1.188" value={host} onChange={(event) => useManualHost(event.target.value)}/></label><label>Cổng<input inputMode="numeric" value={String(port)} onChange={(event) => setPort(Math.max(1, Math.min(65535, Number(event.target.value) || 9100)))}/></label><p>Chỉ dùng khi Tìm máy in không thấy. Thông thường không cần thay đổi cổng.</p></div> : null}
    </section> : null}

    <section className="printer-setting-section printer-compact-options">
      <label><span><strong>Khổ giấy</strong><small>{draft.method === 'DIRECT_WIFI' ? 'Chọn đúng cuộn giấy đang lắp.' : 'Chọn khổ giấy văn phòng cần định dạng.'}</small></span><select value={draft.paper} onChange={(event) => setDraft((current) => ({ ...current, paper: event.target.value as PrinterPaper, profile: current.profile ? { ...current.profile, paper: event.target.value as PrinterPaper } : null }))}>{draft.method === 'DIRECT_WIFI' ? <><option value="80mm">80 mm</option><option value="58mm">58 mm</option></> : <><option value="A4">A4</option><option value="A5">A5</option></>}</select></label>
      {draft.method === 'DIRECT_WIFI' ? <><label><span><strong>Số bản in</strong><small>Tối đa 5 bản mỗi lần.</small></span><select value={draft.copies} onChange={(event) => setDraft((current) => ({ ...current, copies: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="printer-switch"><span><strong>Xem trước trước khi in</strong><small>Tắt để in nhanh khi máy đã sẵn sàng.</small></span><input type="checkbox" checked={draft.previewBeforePrint} onChange={(event) => setDraft((current) => ({ ...current, previewBeforePrint: event.target.checked }))}/></label></> : <p className="settings-help">Máy in, khổ giấy thực tế và số bản được chọn trong cửa sổ in của điện thoại. Nếu cửa sổ này không có đúng khổ giấy, máy in/AirPrint chưa cung cấp khổ đó cho iPhone.</p>}
    </section>

    <div className="printer-test-row"><span><strong>Trạng thái</strong><small>{status}</small></span><button className="secondary-action" type="button" disabled={testing} onClick={() => void testPrinter()}>{testing ? 'Đang kiểm tra…' : 'In thử'}</button></div>

    <div className="settings-sheet-actions"><button className="secondary-action" type="button" onClick={onClose}>Hủy</button><button className="primary-action" type="button" onClick={save}>Lưu thiết lập</button></div>
  </div>;
}
