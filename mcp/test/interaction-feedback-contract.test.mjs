import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adapter = await readFile("src/lib/interaction/interaction-feedback.ts", "utf8");
const provider = await readFile("src/ui/feedback/InteractionFeedbackProvider.tsx", "utf8");
const settings = await readFile("src/features/settings/InteractionFeedbackCard.tsx", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");

test("one shared feedback adapter owns Capacitor, web fallback and preference", () => {
  assert.match(adapter, /INTERACTION_FEEDBACK_STORAGE_KEY = "mcp-plan:interaction-feedback-enabled"/);
  assert.match(adapter, /Capacitor\?: CapacitorBridge/);
  assert.match(adapter, /Plugins\?\.Haptics/);
  assert.match(adapter, /navigator\.vibrate/);
  assert.match(adapter, /if \(!options\.force && !readInteractionFeedbackEnabled\(\)\) return "none"/);
  assert.match(adapter, /catch \{[\s\S]*?fall through to the web adapter/);
});

test("provider delegates intentional clicks and skips disabled or opted-out controls", () => {
  assert.match(provider, /document\.addEventListener\("click", handleClick, true\)/);
  assert.match(provider, /button, a\[href\], summary/);
  assert.match(provider, /data-interaction-feedback/);
  assert.match(provider, /configured === "none"/);
  assert.match(provider, /element\.matches\(":disabled"\)/);
  assert.match(layout, /<InteractionFeedbackProvider>\{children\}<\/InteractionFeedbackProvider>/);
});

test("Settings exposes a persisted accessible vibration switch with enable preview", () => {
  assert.match(settings, /role="switch"/);
  assert.match(settings, /aria-checked=\{enabled\}/);
  assert.match(settings, /data-interaction-feedback="none"/);
  assert.match(settings, /setEnabled\(next\)/);
  assert.match(settings, /feedback\("success", \{ force: true \}\)/);
  assert.match(settings, /Capacitor Haptics/);
});
