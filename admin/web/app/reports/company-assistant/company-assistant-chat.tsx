'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { FormEvent, useEffect, useRef, useState } from 'react';
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

const SUGGESTIONS = [
  'Tóm tắt những điểm cần chú ý hôm nay',
  'Doanh số và công nợ nào cần theo dõi?',
  'Tồn kho nào đang có dấu hiệu bất thường?',
  'MCP và giao hàng có việc gì cần xử lý?',
] as const;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [failedAttempt, setFailedAttempt] = useState<PendingAttempt | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy, failedAttempt]);

  function conversationId(): string {
    if (!conversationRef.current) conversationRef.current = createIdempotencyKey('admin-conversation');
    return conversationRef.current;
  }

  async function sendAttempt(attempt: PendingAttempt, appendOwner = false) {
    setBusy(true);
    setFailedAttempt(null);
    setStatusMessage('Đang tổng hợp số liệu và chuẩn bị câu trả lời…');
    if (appendOwner) {
      setMessages((current) => [
        ...current,
        { id: `${attempt.idempotencyKey}-owner`, role: 'owner', text: attempt.message },
      ]);
    }
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
        { id: `${attempt.idempotencyKey}-reply`, role: 'assistant', text: replyText, usageNote: usageNote(payload ?? {}) },
      ]);
      const returnedConversationId = safeText(payload?.conversationId);
      if (returnedConversationId) conversationRef.current = returnedConversationId;
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
    setInput('');
    void sendAttempt(attempt, true);
  }

  function chooseSuggestion(message: string) {
    if (busy) return;
    setInput(message);
    textareaRef.current?.focus();
  }

  return (
    <section className={styles.workspace} aria-label="Trợ lý Công Ty">
      <header className={styles.hero}>
        <div className={styles.heroMark} aria-hidden="true">✦</div>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Dành cho Chủ Công Ty</span>
          <h2>Hỏi số liệu nhanh, chưa cho phép hành động</h2>
          <p>Trợ lý chỉ đọc dữ liệu được cấp quyền để tổng hợp và trả lời. Không tự tạo, sửa, duyệt hoặc xóa dữ liệu Công Ty.</p>
        </div>
        <span className={styles.readOnlyBadge}><i aria-hidden="true" />Chỉ đọc</span>
      </header>

      <div className={styles.suggestions} aria-label="Câu hỏi gợi ý">
        <span className={styles.suggestionLabel}>Hỏi nhanh</span>
        <div className={styles.suggestionRail}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              className={styles.suggestionButton}
              disabled={busy}
              key={suggestion}
              onClick={() => chooseSuggestion(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chatPanel}>
        <div className={styles.conversation} aria-busy={busy} aria-live="polite">
          {messages.length === 0 && !busy ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyMark} aria-hidden="true">✦</span>
              <strong>Sẵn sàng hỗ trợ anh xem nhanh tình hình Công Ty.</strong>
              <span>Chọn một câu hỏi gợi ý hoặc nhập nội dung bên dưới.</span>
            </div>
          ) : null}

          {messages.map((message) => (
            <article className={message.role === 'owner' ? styles.ownerMessage : styles.assistantMessage} key={message.id}>
              <small>{message.role === 'owner' ? 'Anh' : 'Trợ lý Công Ty'}</small>
              <p>{message.text}</p>
              {message.usageNote ? <span className={styles.usageNote}>{message.usageNote}</span> : null}
            </article>
          ))}

          {busy ? (
            <article className={`${styles.assistantMessage} ${styles.pendingMessage}`}>
              <small>Trợ lý Công Ty</small>
              <div className={styles.pendingRow}>
                <span className={styles.pendingDots} aria-hidden="true"><i /><i /><i /></span>
                <span>Đang tổng hợp số liệu…</span>
              </div>
              <span className={styles.pendingHint}>Câu hỏi tổng hợp có thể cần vài chục giây.</span>
            </article>
          ) : null}

          {statusMessage && !busy ? (
            <div className={failedAttempt ? styles.errorNotice : styles.statusNotice} role="status">
              <strong>{failedAttempt ? 'Lượt hỏi chưa hoàn tất' : 'Thông báo'}</strong>
              <span>{statusMessage}</span>
              {failedAttempt ? (
                <button disabled={busy} onClick={() => void sendAttempt(failedAttempt)} type="button">Thử lại lượt này</button>
              ) : null}
            </div>
          ) : null}
          <div ref={conversationEndRef} />
        </div>

        <form className={styles.composer} onSubmit={submit}>
          <div className={styles.composerTopline}>
            <label htmlFor="company-assistant-message">Câu hỏi cho Trợ lý Công Ty</label>
            <span>Tối đa 6.000 ký tự</span>
          </div>
          <div className={styles.composerBox}>
            <textarea
              id="company-assistant-message"
              maxLength={6000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ví dụ: Tóm tắt những việc cần chú ý hôm nay…"
              ref={textareaRef}
              rows={3}
              value={input}
            />
            <button className={styles.sendButton} disabled={busy || !input.trim()} type="submit">
              <span>{busy ? 'Đang xử lý' : 'Gửi'}</span>
              <b aria-hidden="true">→</b>
            </button>
          </div>
          <div className={styles.composerMeta}>
            <span>Chỉ đọc dữ liệu theo quyền Chủ Công Ty.</span>
            <span>Mỗi lượt hỏi được ghi nhận token và chi phí trong quản lý tín dụng AI.</span>
          </div>
        </form>
      </div>
    </section>
  );
}
