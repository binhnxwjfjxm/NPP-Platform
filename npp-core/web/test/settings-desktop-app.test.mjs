import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('settings opens data backup and exposes the Windows application as a sibling tab', () => {
  const settingsPage = read('app/settings/page.tsx');
  const tabs = read('app/settings/settings-tabs.tsx');
  const backup = read('app/settings/data-backup/data-backup-workspace.tsx');
  const desktopPage = read('app/settings/desktop-app/page.tsx');

  assert.match(settingsPage, /redirect\('\/settings\/data-backup'\)/);
  assert.match(tabs, /Dữ liệu & sao lưu/);
  assert.match(tabs, /Ứng dụng máy tính/);
  assert.match(tabs, /href: '\/settings\/data-backup'/);
  assert.match(tabs, /href: '\/settings\/desktop-app'/);
  assert.match(backup, /<SettingsTabs active="data-backup" \/>/);
  assert.match(desktopPage, /<SettingsTabs active="desktop-app" \/>/);
});

test('web application page only offers the Windows installer, not desktop updater controls', () => {
  const desktopPage = read('app/settings/desktop-app/page.tsx');

  assert.match(desktopPage, /Phiên bản \{WINDOWS_RELEASE\.version\}/);
  assert.match(desktopPage, /Tải ứng dụng Windows/);
  assert.match(desktopPage, /Hung-Phat-Desktop-0\.1\.3-Setup\.exe/);
  assert.match(desktopPage, /thực hiện trực tiếp bên trong ứng dụng máy tính/);
  assert.doesNotMatch(desktopPage, />\s*Kiểm tra cập nhật\s*</);
  assert.doesNotMatch(desktopPage, />\s*Cập nhật ngay\s*</);
});
