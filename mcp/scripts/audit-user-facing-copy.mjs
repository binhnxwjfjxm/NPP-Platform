import fs from "node:fs";
import path from "node:path";

const srcRoot = path.join(process.cwd(), "src");
const explicitTsFiles = new Set([
  path.join(srcRoot, "ui", "shell", "navigation.ts"),
  path.join(srcRoot, "app", "manifest.ts")
]);
const forbidden = [
  "Frontend sạch trước",
  "Backend/VPS",
  "API thật",
  "Dữ liệu mẫu",
  "master data",
  "RPC hard delete",
  "Xóa thật khỏi DB",
  "Admin phụ",
  "Session setup",
  "Snapshot v2",
  "AI Prompt Context",
  "ADK Agent",
  "rebuild BC",
  "Đang rebuild",
  "MCP Setting",
  "Cai dat app",
  "Tai app",
  "Cap nhat ban moi",
  "popup mobile-first",
  "Khi nối backend thật",
  "Daily Session",
  "Global template",
  "product catalog thật",
  "Dữ liệu từ phiên MCP",
  "Route Master",
  "Route Customer Master",
  "Session Customer Snapshot",
  "MCP Daily Session",
  "MCP Report Agent",
  "popup BC",
  "dàn flat",
  "bam Chia se",
  "Dang mo...",
  "Bo loc nhanh",
  "Đánh giá snapshot",
  "Đơn/Test",
  "Theo snapshot đã chốt",
  "Đọc từ health đã lưu",
  "customer_details hoàn chỉnh",
  "Supabase live",
  "Tuyến active",
  "Xem test"
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(srcRoot, "app", "api")) return [];
      return walk(full);
    }
    if (entry.name.endsWith(".tsx") || explicitTsFiles.has(full)) return [full];
    return [];
  });
}

const failures = [];
for (const filename of walk(srcRoot)) {
  const content = fs.readFileSync(filename, "utf8");
  for (const phrase of forbidden) {
    if (content.includes(phrase)) failures.push(path.relative(process.cwd(), filename) + ": " + phrase);
  }
}

const sourceFiles = walk(srcRoot);
const integrityChecks = [
  { path: "src/features/mcp/McpSessionsManagerSafe.tsx", phrase: "lượt thửCount" },
  { path: "src/features/market-checks/MarketChecksClientPage.tsx", phrase: "Phiên: check.sessionId" },
  { path: "src/features/mcp/McpSessionCompactViewFinal2.tsx", phrase: "TEST_PRODUCT_CHIPS" },
  { path: "src/features/mcp/McpMarketReportFields.tsx", phrase: "USED_PRODUCT_GROUPS" }
];
for (const check of integrityChecks) {
  const content = fs.readFileSync(path.join(process.cwd(), check.path), "utf8");
  if (content.includes(check.phrase)) failures.push(check.path + ": " + check.phrase);
}
if (failures.length) {
  console.error("Phát hiện nội dung kỹ thuật, nội dung mẫu hoặc lỗi toàn vẹn do thay copy:");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}
console.log("User-facing copy audit passed.");
