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
  onPaired(agent: RetailPrintAgent): void;
};

function statusLabel(agent: RetailPrintAgent) {
  return agent.status === 'ONLINE' ? 'Đang trực tuyến' : 'Đang ngoại tuyến';
}

export function RetailPrintWindowsPairing({ onNotice, onError, onPaired }: Props) {
  const [agents, setAgents] = useState<RetailPrintAgent[]>([]);
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      setAgents(await listRetailPrintAgents());
    } catch {
      // Danh sách chỉ để hiển thị; người dùng vẫn có thể nhập mã cố định để kết nối.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

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
      setAgents((current) => [agent, ...current.filter((item) => item.id !== agent.id)]);
      onPaired(agent);
      onNotice(`${agent.name} đã kết nối với điện thoại này. Mã vẫn dùng được trên các điện thoại Retail khác.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Không thể kết nối Retail Print.');
    } finally {
      setPairing(false);
    }
  }

  return <section className="printer-setting-section printer-pairing-section">
    <header>
      <strong>Retail Print trên Windows</strong>
      <small>Nhập mã cố định 8 ký tự của máy Windows để kết nối.</small>
    </header>
    <div className="printer-pairing-card">
      <div className="printer-pairing-entry">
        <label><span>Mã kết nối</span>
          <input
            value={pairingCode}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect="off"
            placeholder="8 ký tự trên Retail Print"
            onChange={(event) => setPairingCode(event.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8))}
          />
        </label>
        <button className="primary-action printer-pair-button" type="button" disabled={pairing} onClick={() => void pair()}>{pairing ? 'Đang kết nối…' : 'Kết nối'}</button>
      </div>
      <p className="printer-pairing-note">Mã trên máy Windows là cố định. Điện thoại Retail nào cũng nhập cùng mã này để kết nối đúng máy đó.</p>
      <div className="printer-pairing-heading">
        <span><i aria-hidden="true" /> <strong>Thiết bị đã kết nối</strong></span>
        <small>{loading ? 'Đang kiểm tra…' : `${agents.length} máy`}</small>
      </div>
      {agents.length ? <div className="printer-results printer-agent-results" aria-label="Retail Print trên Windows">
        {agents.map((agent) => <div className="selected-printer printer-agent-card" key={agent.id}>
          <span className={`printer-status ${agent.status === 'ONLINE' ? 'ready' : ''}`} aria-hidden="true">●</span>
          <div><strong>{agent.name}</strong><small>{agent.printerName || 'Máy in Windows'}</small></div>
          <span className={`printer-agent-status ${agent.status === 'ONLINE' ? 'ready' : ''}`}>{statusLabel(agent)}</span>
        </div>)}
      </div> : <p className="printer-empty printer-pairing-empty">Chưa có máy Windows nào được kết nối.</p>}
      <small className="printer-pairing-footnote">Mã không mất sau khi kết nối.</small>
    </div>
  </section>;
}
