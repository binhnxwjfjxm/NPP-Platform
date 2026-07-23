"use client";

import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallAppCard() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState("Có thể cài MCP-Plan như một ứng dụng riêng trên điện thoại.");

  const platformHint = useMemo(() => {
    if (typeof navigator === "undefined") return "";
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("iphone") || userAgent.includes("ipad")) return "iPhone/iPad: bấm Chia sẻ, sau đó chọn Thêm vào màn hình chính.";
    return "Android/Chrome: bấm Cài ứng dụng hoặc mở menu trình duyệt và chọn Thêm vào màn hình chính.";
  }, []);

  useEffect(() => {
    setIsStandalone(isStandaloneMode());
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setMessage("Thiết bị này có thể cài MCP-Plan như một ứng dụng riêng.");
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (isInstalling) return;
    if (isStandalone) { setMessage("MCP-Plan đã được cài trên thiết bị này."); return; }
    if (!installPrompt) { setMessage(platformHint || "Trình duyệt hiện chưa hỗ trợ nút cài đặt tự động."); return; }
    setIsInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setMessage(choice.outcome === "accepted" ? "Đã gửi yêu cầu cài ứng dụng." : "Đã hủy cài ứng dụng.");
    } finally { setIsInstalling(false); }
  }

  async function handleRefreshApp() {
    if (isUpdating) return;
    setIsUpdating(true);
    setMessage("Đang kiểm tra và làm mới ứng dụng...");
    try {
      if ("caches" in window) { const names = await caches.keys(); await Promise.all(names.map((name) => caches.delete(name))); }
      if ("serviceWorker" in navigator) { const registrations = await navigator.serviceWorker.getRegistrations(); await Promise.all(registrations.map((registration) => registration.update())); }
      window.setTimeout(() => window.location.reload(), 300);
    } catch {
      setMessage("Chưa thể làm mới tự động. Vui lòng tải lại trang một lần nữa.");
      setIsUpdating(false);
    }
  }

  return <div className="card settings-card">
    <div><span className="badge">Cài trên thiết bị</span><h2 className="panel-title">Cài ứng dụng và cập nhật phiên bản</h2><p className="page-subtitle">{message}</p><p className="settings-hint">{platformHint}</p></div>
    <div className="settings-actions">
      <button className="button primary" disabled={isInstalling || isUpdating} onClick={handleInstall} type="button">{isInstalling ? "Đang mở..." : "Cài ứng dụng"}</button>
      <button className="button" disabled={isUpdating} onClick={handleRefreshApp} type="button">{isUpdating ? "Đang làm mới..." : "Cập nhật bản mới"}</button>
    </div>
  </div>;
}
