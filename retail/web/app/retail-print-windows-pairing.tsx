'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listRetailPrintAgents,
  pairRetailPrintAgent,
  type RetailPrintAgent,
} from '../lib/retail-print-agent';

type Props = {
  onNotice(message: string): void;
  onError(message: string): void;
};

function statusLabel(agent: RetailPrintAgent) {
  return agent.status === 'ONLINE' ? 'Đang trực tuyến' : 'Đang ngoại tuyến';
}

export function RetailPrintWindowsPairing({ onNotice, onError }: Props) {
  const [agents, setAgents] = useState<RetailPrintAgent[]>([]);
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setAgents(await listRetailPrintAgents());
    } catch (reason) {
      if (!quiet) onError(reason instanceof Error ? reason.message : 'Chưa thể tải Retail Print trên Windows.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  async function pair() {
    const code = pairingCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      onError('Mã kết nối phải gồm đúng 8 ký tự.');
      return;
    }
    setPairing(true);
    onError('');
    try {
      const agent = await pairRetailPrintAgent(code);
      setPairingCode('');
      await refresh(true);
      onNotice(`${agent.name} đã kết nối với Retail.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Không thể kết nối Retail Print.');
    } finally {
      setPairing(false);
    }
  }

  return <section className="printer-setting-section">
    <header>
      <strong>Retail Print trên Windows</strong>
      <small>Máy Windows nhận lệnh in từ Retail và gửi tới máy in đã thiết lập.</small>
    </header>
    <div className="printer-advanced">
      <label>Mã kết nối
        <input
          value={pairingCode}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="8 ký tự trên Retail Print"
          onChange={(event) => setPairingCode(event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8))}
        />
      </label>
      <p>Mở Retail Print trên Windows → Lấy mã → nhập mã vào đây. Không cần nhập IP máy in trên điện thoại.</p>
      <div className="printer-test-row">
        <span><strong>{agents.length ? `${agents.length} máy đã kết nối` : 'Chưa có máy Windows'}</strong><small>{loading ? 'Đang kiểm tra…' : 'Mã chỉ dùng một lần và tự hết hạn.'}</small></span>
        <button className="secondary-action" type="button" disabled={pairing} onClick={() => void pair()}>{pairing ? 'Đang kết nối…' : 'Kết nối'}</button>
      </div>
      {agents.length ? <div className="printer-results" aria-label="Retail Print trên Windows">
        {agents.map((agent) => <div className="selected-printer" key={agent.id}>
          <span className={`printer-status ${agent.status === 'ONLINE' ? 'ready' : ''}`} aria-hidden="true">●</span>
          <div><strong>{agent.name}</strong><small>{statusLabel(agent)}{agent.printerName ? ` · ${agent.printerName}` : ''}</small></div>
        </div>)}
      </div> : null}
      <button className="advanced-toggle" type="button" onClick={() => void refresh(false)}>Làm mới danh sách</button>
    </div>
  </section>;
}
