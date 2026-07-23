export type InteractionFeedbackKind = "selection" | "light" | "medium" | "success" | "warning" | "error";
export type InteractionFeedbackChannel = "capacitor" | "web" | "none";

export const INTERACTION_FEEDBACK_STORAGE_KEY = "mcp-plan:interaction-feedback-enabled";
export const INTERACTION_FEEDBACK_CHANGE_EVENT = "mcp-plan:interaction-feedback-change";
export const DEFAULT_INTERACTION_FEEDBACK_ENABLED = true;

type HapticsPlugin = {
  impact?: (options: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void> | void;
  notification?: (options: { type: "SUCCESS" | "WARNING" | "ERROR" }) => Promise<void> | void;
  selectionChanged?: () => Promise<void> | void;
  vibrate?: (options: { duration: number }) => Promise<void> | void;
};

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: { Haptics?: HapticsPlugin };
};

function browserAvailable() {
  return typeof window !== "undefined";
}

export function readInteractionFeedbackEnabled() {
  if (!browserAvailable()) return DEFAULT_INTERACTION_FEEDBACK_ENABLED;
  try {
    const stored = window.localStorage.getItem(INTERACTION_FEEDBACK_STORAGE_KEY);
    if (stored === "0" || stored === "false") return false;
    if (stored === "1" || stored === "true") return true;
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return DEFAULT_INTERACTION_FEEDBACK_ENABLED;
}

export function writeInteractionFeedbackEnabled(enabled: boolean) {
  if (!browserAvailable()) return;
  try {
    window.localStorage.setItem(INTERACTION_FEEDBACK_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Keep the in-memory preference even when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(INTERACTION_FEEDBACK_CHANGE_EVENT, { detail: { enabled } }));
}

function capacitorHaptics(): HapticsPlugin | null {
  if (!browserAvailable()) return null;
  const bridge = (window as typeof window & { Capacitor?: CapacitorBridge }).Capacitor;
  const haptics = bridge?.Plugins?.Haptics;
  if (!haptics) return null;
  if (typeof bridge?.isNativePlatform === "function" && !bridge.isNativePlatform()) return null;
  return haptics;
}

export function getInteractionFeedbackChannel(): InteractionFeedbackChannel {
  if (!browserAvailable()) return "none";
  if (capacitorHaptics()) return "capacitor";
  return typeof window.navigator.vibrate === "function" ? "web" : "none";
}

async function runCapacitorFeedback(plugin: HapticsPlugin, kind: InteractionFeedbackKind) {
  if (kind === "selection" && plugin.selectionChanged) return plugin.selectionChanged();
  if ((kind === "success" || kind === "warning" || kind === "error") && plugin.notification) {
    return plugin.notification({ type: kind.toUpperCase() as "SUCCESS" | "WARNING" | "ERROR" });
  }
  if (plugin.impact) {
    const style = kind === "medium" || kind === "warning" || kind === "error" ? "MEDIUM" : "LIGHT";
    return plugin.impact({ style });
  }
  if (plugin.vibrate) return plugin.vibrate({ duration: kind === "error" ? 50 : 18 });
}

function webPattern(kind: InteractionFeedbackKind): number | number[] {
  if (kind === "selection") return 8;
  if (kind === "light") return 12;
  if (kind === "medium") return 22;
  if (kind === "success") return [12, 35, 18];
  if (kind === "warning") return [18, 42, 18];
  return [28, 42, 28];
}

export async function performInteractionFeedback(kind: InteractionFeedbackKind): Promise<InteractionFeedbackChannel> {
  if (!browserAvailable()) return "none";

  const haptics = capacitorHaptics();
  if (haptics) {
    try {
      await runCapacitorFeedback(haptics, kind);
      return "capacitor";
    } catch {
      // Native haptics are best-effort; fall through to the web adapter.
    }
  }

  if (typeof window.navigator.vibrate === "function") {
    try {
      window.navigator.vibrate(webPattern(kind));
      return "web";
    } catch {
      // Unsupported or blocked vibration must never break the user action.
    }
  }

  return "none";
}

export async function interactionFeedback(
  kind: InteractionFeedbackKind = "selection",
  options: { force?: boolean } = {}
): Promise<InteractionFeedbackChannel> {
  if (!options.force && !readInteractionFeedbackEnabled()) return "none";
  return performInteractionFeedback(kind);
}
