import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`timeout_waiting_for_${url}`);
}

await waitForHttp(`${appBase}/settings`);
const browser = await chromium.launch({ headless: true });
const result = { INTERACTION_FEEDBACK_BROWSER_SMOKE: "FAIL" };

try {
  const webContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await webContext.addInitScript(() => {
    window.__feedbackEvents = [];
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value(pattern) {
        window.__feedbackEvents.push({ channel: "web", pattern });
        return true;
      }
    });
  });
  const webPage = await webContext.newPage();
  await webPage.goto(`${appBase}/settings`, { waitUntil: "networkidle" });
  await webPage.locator("[data-app-top-bar]").getByText("Cài đặt ứng dụng", { exact: true }).waitFor({ state: "visible" });

  const feedbackSwitch = webPage.getByRole("switch", { name: "Phản hồi rung", exact: true });
  await feedbackSwitch.waitFor({ state: "visible" });
  assert.equal(await feedbackSwitch.getAttribute("aria-checked"), "true");

  const menuTrigger = webPage.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  await menuTrigger.click();
  await webPage.getByRole("dialog").last().waitFor({ state: "visible" });
  await webPage.keyboard.press("Escape");
  const initialWebCount = await webPage.evaluate(() => window.__feedbackEvents.length);
  assert.ok(initialWebCount >= 1, "enabled web feedback must call navigator.vibrate");

  await feedbackSwitch.click();
  assert.equal(await feedbackSwitch.getAttribute("aria-checked"), "false");
  assert.equal(await webPage.evaluate(() => localStorage.getItem("mcp-plan:interaction-feedback-enabled")), "0");
  const disabledCount = await webPage.evaluate(() => window.__feedbackEvents.length);
  await menuTrigger.click();
  await webPage.getByRole("dialog").last().waitFor({ state: "visible" });
  await webPage.keyboard.press("Escape");
  assert.equal(await webPage.evaluate(() => window.__feedbackEvents.length), disabledCount, "disabled feedback must not vibrate");

  await webPage.reload({ waitUntil: "networkidle" });
  const persistedSwitch = webPage.getByRole("switch", { name: "Phản hồi rung", exact: true });
  assert.equal(await persistedSwitch.getAttribute("aria-checked"), "false", "preference must survive reload");
  await persistedSwitch.click();
  assert.equal(await persistedSwitch.getAttribute("aria-checked"), "true");
  assert.equal(await webPage.evaluate(() => localStorage.getItem("mcp-plan:interaction-feedback-enabled")), "1");
  assert.ok(await webPage.evaluate(() => window.__feedbackEvents.length > 0), "enabling must play a success preview");
  await webPage.screenshot({ path: `${resultsDir}/15-interaction-feedback-setting.png`, fullPage: true });
  await webContext.close();

  const nativeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await nativeContext.addInitScript(() => {
    window.__feedbackEvents = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Haptics: {
          selectionChanged() {
            window.__feedbackEvents.push({ channel: "capacitor", kind: "selection" });
          },
          impact({ style }) {
            window.__feedbackEvents.push({ channel: "capacitor", kind: "impact", style });
          },
          notification({ type }) {
            window.__feedbackEvents.push({ channel: "capacitor", kind: "notification", type });
          }
        }
      }
    };
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value(pattern) {
        window.__feedbackEvents.push({ channel: "web", pattern });
        return true;
      }
    });
  });
  const nativePage = await nativeContext.newPage();
  await nativePage.goto(`${appBase}/settings`, { waitUntil: "networkidle" });
  await nativePage.getByRole("button", { name: "Mở menu ứng dụng", exact: true }).click();
  const nativeEvents = await nativePage.evaluate(() => window.__feedbackEvents);
  assert.ok(nativeEvents.some((event) => event.channel === "capacitor"), "Capacitor Haptics must be used in native runtime");
  assert.equal(nativeEvents.some((event) => event.channel === "web"), false, "web vibration must not run when Capacitor succeeds");
  await nativeContext.close();

  result.INTERACTION_FEEDBACK_BROWSER_SMOKE = "PASS";
  result.settingsTopBar = "PASS";
  result.webPreference = "PASS";
  result.persistedSetting = "PASS";
  result.capacitorPriority = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/interaction-feedback-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
