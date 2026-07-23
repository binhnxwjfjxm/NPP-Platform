"use client";

import { useEffect, useState } from "react";
import { getInteractionFeedbackChannel, type InteractionFeedbackChannel } from "@/lib/interaction/interaction-feedback";
import { useInteractionFeedback } from "@/ui/feedback/InteractionFeedbackProvider";
import styles from "./InteractionFeedbackCard.module.css";

function channelLabel(channel: InteractionFeedbackChannel) {
  if (channel === "capacitor") return "Haptic native qua Capacitor";
  if (channel === "web") return "Rung thiết bị qua trình duyệt";
  return "Thiết bị không hỗ trợ rung; giao diện vẫn phản hồi khi nhấn";
}

export function InteractionFeedbackCard() {
  const { enabled, setEnabled, feedback } = useInteractionFeedback();
  const [channel, setChannel] = useState<InteractionFeedbackChannel>("none");

  useEffect(() => {
    setChannel(getInteractionFeedbackChannel());
  }, []);

  async function toggleFeedback() {
    const next = !enabled;
    setEnabled(next);
    if (next) {
      const used = await feedback("success", { force: true });
      if (used !== "none") setChannel(used);
    }
  }

  return (
    <section className={`card settings-card ${styles.card}`} data-interaction-feedback-setting>
      <div className={styles.header}>
        <div>
          <span className="badge">Tương tác</span>
          <h2 className="panel-title">Phản hồi rung</h2>
          <p className="page-subtitle">Rung nhẹ khi bấm nút và phản hồi rõ hơn cho thao tác thành công, cảnh báo hoặc lỗi.</p>
        </div>
        <button
          aria-checked={enabled}
          aria-label="Phản hồi rung"
          className={`${styles.switch} ${enabled ? styles.switchOn : ""}`}
          data-interaction-feedback="none"
          role="switch"
          type="button"
          onClick={() => void toggleFeedback()}
        >
          <span className={styles.thumb} />
        </button>
      </div>

      <div className={styles.status}>
        <span className={styles.statusIcon} aria-hidden="true">{enabled ? "≈" : "—"}</span>
        <div>
          <strong>{enabled ? "Đang bật" : "Đang tắt"}</strong>
          <small>{channelLabel(channel)}</small>
        </div>
      </div>

      <p className={styles.note}>Tùy chọn được lưu trên thiết bị này. Khi đóng gói app native, lớp dùng chung sẽ ưu tiên Capacitor Haptics; trên web sẽ tự fallback và không làm gián đoạn thao tác nếu trình duyệt chặn rung.</p>
    </section>
  );
}
