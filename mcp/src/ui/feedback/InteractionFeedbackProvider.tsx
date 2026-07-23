"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  DEFAULT_INTERACTION_FEEDBACK_ENABLED,
  INTERACTION_FEEDBACK_CHANGE_EVENT,
  getInteractionFeedbackChannel,
  interactionFeedback,
  readInteractionFeedbackEnabled,
  writeInteractionFeedbackEnabled,
  type InteractionFeedbackChannel,
  type InteractionFeedbackKind
} from "@/lib/interaction/interaction-feedback";

type InteractionFeedbackContextValue = {
  enabled: boolean;
  channel: InteractionFeedbackChannel;
  setEnabled: (enabled: boolean) => void;
  feedback: (kind?: InteractionFeedbackKind, options?: { force?: boolean }) => Promise<InteractionFeedbackChannel>;
};

const InteractionFeedbackContext = createContext<InteractionFeedbackContextValue | null>(null);

function feedbackKindForElement(element: Element): InteractionFeedbackKind | null {
  const configured = element.getAttribute("data-interaction-feedback");
  if (configured === "none") return null;
  if (configured === "selection" || configured === "light" || configured === "medium" || configured === "success" || configured === "warning" || configured === "error") return configured;
  if (element.classList.contains("danger") || element.getAttribute("data-tone") === "danger") return "warning";
  return "selection";
}

function actionableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("button, a[href], summary, [role='button'], [role='tab'], [data-interaction-feedback]");
}

function isDisabled(element: HTMLElement) {
  return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
}

export function InteractionFeedbackProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(DEFAULT_INTERACTION_FEEDBACK_ENABLED);
  const [channel, setChannel] = useState<InteractionFeedbackChannel>("none");

  useEffect(() => {
    setEnabledState(readInteractionFeedbackEnabled());
    setChannel(getInteractionFeedbackChannel());

    function syncPreference(event: Event) {
      const custom = event as CustomEvent<{ enabled?: boolean }>;
      setEnabledState(typeof custom.detail?.enabled === "boolean" ? custom.detail.enabled : readInteractionFeedbackEnabled());
    }

    window.addEventListener(INTERACTION_FEEDBACK_CHANGE_EVENT, syncPreference);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(INTERACTION_FEEDBACK_CHANGE_EVENT, syncPreference);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!enabled) return;
      const element = actionableElement(event.target);
      if (!element || isDisabled(element)) return;
      const kind = feedbackKindForElement(element);
      if (!kind) return;
      void interactionFeedback(kind);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeInteractionFeedbackEnabled(next);
  }, []);

  const feedback = useCallback(
    async (kind: InteractionFeedbackKind = "selection", options: { force?: boolean } = {}) => {
      if (!enabled && !options.force) return "none" as const;
      const used = await interactionFeedback(kind, options);
      if (used !== "none") setChannel(used);
      return used;
    },
    [enabled]
  );

  const value = useMemo(() => ({ enabled, channel, setEnabled, feedback }), [enabled, channel, setEnabled, feedback]);
  return <InteractionFeedbackContext.Provider value={value}>{children}</InteractionFeedbackContext.Provider>;
}

export function useInteractionFeedback() {
  const context = useContext(InteractionFeedbackContext);
  if (!context) throw new Error("useInteractionFeedback must be used inside InteractionFeedbackProvider");
  return context;
}
