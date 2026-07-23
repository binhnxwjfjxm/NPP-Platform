param(
  [string]$ProjectRoot = "F:\1_A_Disk_D\Tool\mcp-plan",
  [switch]$CommitAndPush
)

$ErrorActionPreference = "Stop"

function Fail($message) {
  Write-Host ""
  Write-Host "LOI: $message" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $ProjectRoot)) {
  Fail "Khong tim thay project root: $ProjectRoot"
}

Set-Location $ProjectRoot

$uiPath = Join-Path $ProjectRoot "src\features\mcp\McpSessionCompactView.tsx"
if (-not (Test-Path $uiPath)) {
  Fail "Khong tim thay file UI: $uiPath"
}

$backupDir = Join-Path $env:TEMP ("mcp-test-fix-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item $uiPath (Join-Path $backupDir "McpSessionCompactView.tsx.bak")
Write-Host "Backup nam ngoai repo: $backupDir" -ForegroundColor Cyan

$content = [System.IO.File]::ReadAllText($uiPath, [System.Text.Encoding]::UTF8)

# Fix dung loi TypeScript:
# Sau khi tach test thanh flow rieng, nhanh else cuoi chi con report.
# Vi vay khong duoc so sanh resultType === "test" nua.
$pattern = 'const resultType = selectedAction\.action === "market_report" \? "report" : selectedAction\.action;\s*await postMcpBackend\("/api/backend/mcp-day/session-customer/result", \{ sessionCustomerId, resultType, note: mcpCustomerActionDescription\(selectedAction\.action\), hasTest: resultType === "test" \? true : undefined, hasReport: resultType === "report" \? true : undefined \}\);'

$replacement = @'
await postMcpBackend("/api/backend/mcp-day/session-customer/result", {
            sessionCustomerId,
            resultType: "report",
            note: mcpCustomerActionDescription(selectedAction.action),
            hasReport: true
          });
'@

$newContent = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement)

if ($newContent -eq $content) {
  if ($content -match 'resultType === "test"') {
    Fail "Van thay resultType === test nhung pattern khong khop. Dung lai, gui log nay cho ChatGPT."
  } elseif ($content -match 'resultType: "report"') {
    Write-Host "File co ve da duoc sua truoc do. Tiep tuc build." -ForegroundColor Yellow
  } else {
    Fail "Khong tim thay doan can sua. Dung lai, gui log nay cho ChatGPT."
  }
} else {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($uiPath, $newContent, $utf8NoBom)
  Write-Host "Da sua loi TypeScript trong McpSessionCompactView.tsx" -ForegroundColor Green
}

Write-Host ""
Write-Host "Dang build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
  Fail "Build van loi. KHONG git add/commit/push. Gui nguyen log build cho ChatGPT."
}

Write-Host ""
Write-Host "BUILD OK" -ForegroundColor Green

if ($CommitAndPush) {
  Write-Host ""
  Write-Host "Dang commit va push..." -ForegroundColor Cyan
  git add apps/backend/server.js src/features/mcp/McpSessionCompactView.tsx supabase/migrations/20260705_mcp_test_from_session_customer_contract.sql
  git commit -m "feat: add MCP test form flow"
  if ($LASTEXITCODE -ne 0) {
    Fail "git commit loi. Chay git status --short va gui log."
  }
  git push origin main
  if ($LASTEXITCODE -ne 0) {
    Fail "git push loi. Gui log."
  }
  Write-Host ""
  Write-Host "DA PUSH XONG. Sau do moi pullmcp tren VPS." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "Chua commit/push. Neu muon script tu commit + push, chay lai:" -ForegroundColor Yellow
  Write-Host 'powershell -ExecutionPolicy Bypass -File .\fix-mcp-test-build.ps1 -CommitAndPush' -ForegroundColor Yellow
}
