$ErrorActionPreference = "Stop"
$repo = "F:\1_A_Disk_D\Tool\mcp-plan"
$file = Join-Path $repo "src\app\globals.css"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

$oldButton = @'
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  font-weight: 700;
  min-height: 40px;
  padding: 10px 14px;
}

.button.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}
'@

$newButton = @'
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  font-weight: 700;
  min-height: 40px;
  padding: 10px 14px;
  text-align: center;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease, opacity 140ms ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.button:hover:not(:disabled) {
  background: var(--panel-soft);
  border-color: #cbd5e1;
  box-shadow: 0 8px 18px rgba(16, 24, 40, 0.08);
  transform: translateY(-1px);
}

.button:active:not(:disabled) {
  box-shadow: none;
  transform: translateY(0) scale(0.98);
}

.button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
}

.button:disabled,
.button[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.56;
  pointer-events: none;
}

.button.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}

.button.primary:hover:not(:disabled) {
  background: var(--brand-strong);
  border-color: var(--brand-strong);
}
'@

if ($content -notlike "*Bottom sheet overlay shell*") {
  if (-not $content.Contains($oldButton)) {
    throw "Không tìm thấy block .button cũ để thay thế. Dừng để tránh patch chắp vá."
  }

  $content = $content.Replace($oldButton, $newButton)
  $content = $content.TrimEnd() + "`r`n`r`n/* Bottom sheet overlay shell */
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(16, 24, 40, 0.54);
  padding: 16px;
  overscroll-behavior: contain;
  touch-action: none;
}

.bottom-sheet {
  width: min(760px, 100%);
  max-height: min(88dvh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 24px 24px 18px 18px;
  box-shadow: 0 -24px 70px rgba(16, 24, 40, 0.28);
  overscroll-behavior: contain;
  touch-action: auto;
  outline: none;
}

.sheet-handle {
  width: 44px;
  height: 5px;
  flex: 0 0 auto;
  align-self: center;
  border-radius: 999px;
  background: var(--line);
  margin: 10px 0 4px;
}

.sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex: 0 0 auto;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--line);
}

.sheet-header h2 {
  font-size: 20px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0;
}

.sheet-header p {
  color: var(--muted);
  line-height: 1.5;
  margin: 6px 0 0;
}

.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.sheet-close:hover {
  background: var(--brand-soft);
  border-color: rgba(37, 99, 235, 0.28);
  color: var(--brand-strong);
}

.sheet-close:active {
  transform: scale(0.94);
}

.sheet-close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
}

.sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px 20px;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.sheet-footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  flex: 0 0 auto;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 -12px 24px rgba(16, 24, 40, 0.06);
}

.sheet-action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sheet-action-grid .button,
.sheet-action-grid a.button {
  flex: 1 1 160px;
}

@media (max-width: 640px) {
  .sheet-backdrop {
    padding: 0;
  }

  .bottom-sheet {
    width: 100%;
    max-height: 92dvh;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 22px 22px 0 0;
  }

  .sheet-header,
  .sheet-body,
  .sheet-footer {
    padding-right: 16px;
    padding-left: 16px;
  }
}`r`n"
} else {
  Write-Host "Bottom sheet CSS block already exists. Only verifying file."
}

[System.IO.File]::WriteAllText($file, $content, $utf8NoBom)
Write-Host "Patched src/app/globals.css"
