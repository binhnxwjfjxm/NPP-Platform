'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { FormEvent, useRef, useState } from 'react';
import styles from './company-assistant.module.css';

type ChatMessage = {
  id: string;
  role: 'owner' | 'assistant';
  text: string;
  usageNote?: string;
};

type PendingAttempt = {
  message: string;
  conversationId: string;
  idempotencyKey: string;
};

type AssistantResponse = {
  replyText?: unknown;
  conversationId?: unknown;
  usageRecorded?: unknown;
  usage?: { totalTokens?: unknown; usageUsd?: unknown } | null;
};

type ErrorResponse = { message?: unknown; retryable?: unknown };

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function usageNote(payload: AssistantResponse): string | undefined {
  if (payload.usageRecorded !== true) return 'Số liệu mức sử dụng của lượt này đang chờ ghi nhận.';
  const totalTokens = Number(payload.usage?.totalTokens ?? 0);
  const usageUsd = safeText(payload.usage?.usageUsd);
  if (!Number.isFinite(totalTokens) || totalTokens < 0 || !usageUsd) return 'Mức sử dụng đã được ghi nhận.';
  return `${new Intl.NumberFormat('vi-VN').format(totalTokens)} token · ${usageUsd} USD`;
}

export function CompanyAssistantChat() {
  const conversationRef = useRef('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [failedAttempt, setFailedAttempt] = useState<PendingAttempt | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function conversationId(): string {
    if (!conversationRef.current) conversationRef.current = createIdempotencyKey('admin-conversation');
    return conversationRef.current;
  }

  async function sendAttempt(attempt: PendingAttempt) {
    setBusy(true);
    setFailedAttempt(null);
    setStatusMessage('Đang hỏi Trợ lý Công Ty…');
    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': attempt.idempotencyKey,
        },
        body: JSON.stringify({ message: attempt.message, conversationId: attempt.conversationId }),
      });
      const payload = await response.json().catch(() => null) as AssistantResponse & ErrorResponse | null;
      if (!response.ok) {
        const retryable = payload?.retryable === true;
        const message = safeText(payload?.message) || 'Trợ lý Công Ty tạm thời chưa sẵn sàng.';
        setStatusMessage(message);
        if (retryable) setFailedAttempt(attempt);
        return;
      }
      const replyText = safeText(payload?.replyText);
      if (!replyText) {
        setStatusMessage('Trợ lý Công Ty chưa trả được câu trả lời.');
        setFailedAttempt(attempt);
        return;
      }
      setMessages((current) => [
        ...current,
        { id: attempt.idempotencyKey, role: 'owner', text: attempt.message },
        { id: `${attempt.idempotencyKey}-reply`, role: 'assistant', text: replyText, usageNote: usageNote(payload ?? {}) },
      ]);
      setInput('');
      setStatusMessage('');
    } catch {
      setStatusMessage('Kết nối tạm thời gián đoạn. Anh có thể thử lại đúng lượt hỏi này.');
      setFailedAttempt(attempt);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const attempt = Object.freeze({
      message,
      conversationId: conversationId(),
      idempotencyKey: createIdempotencyKey('admin-assistant'),
    });
    void sendAttempt(attempt);
  }

  return (
    <section className={`card ${styles.workspace}`} aria-label="Trợ lý Công Ty">
      <div className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>Dành cho Chủ Công Ty</span>
          <h2>Hỏi nhanh, đọc số liệu, chưa cho phép hành động</h2>
          <p>Giai đoạn đầu chỉ mở quyền đọc. Trợ lý không tự tạo, sửa, duyệt hoặc xóa dữ liệu Công Ty.</p>
        </div>
        <span className={styles.readOnlyBadge}>Chỉ đọc</span>
      </div>

      <div className={styles.conversation} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>Có thể bắt đầu bằng một câu hỏi quản trị.</strong>
            <span>Ví dụ: “Tóm tắt những điểm cần chú ý hôm nay.”</span>
          </div>
        ) : messages.map((message) => (
          <article className={message.role === 'owner' ? styles.ownerMessage : styles.assistantMessage} key={message.id}>
            <small>{message.role === 'owner' ? 'Anh' : 'Trợ lý Công Ty'}</small>
            <p>{message.text}</p>
            {message.usageNote ? <span className={styles.usageNote}>{message.usageNote}</span> : null}
          </article>
        ))}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="company-assistant-message">Nội dung cần hỏi</label>
        <textarea
          id="company-assistant-message"
          maxLength={6000}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Nhập câu hỏi quản trị…"
          rows={4}
          value={input}
        />
        <div className={styles.composerActions}>
          <span>{statusMessage || 'Mỗi lượt hỏi được ghi nhận token và chi phí vào báo cáo AI / tín dụng.'}</span>
          <button disabled={busy || !input.trim()} type="submit">{busy ? 'Đang gửi…' : 'Gửi câu hỏi'}</button>
        </div>
      </form>

      {failedAttempt ? (
        <div className={styles.retryBar}>
          <span>Lượt hỏi chưa hoàn tất.</span>
          <button disabled={busy} onClick={() => void sendAttempt(failedAttempt)} type="button">Thử lại</button>
        </div>
      ) : null}
    </section>
  );
}
