import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../app/components/app-shell.module.css', import.meta.url), 'utf8');
const inventorySource = readFileSync(new URL('../app/inventory/inventory-scoped-workspace.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../app/components/modal.tsx', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../app/components/modal.module.css', import.meta.url), 'utf8');
const authMeSource = readFileSync(new URL('../app/api/auth/me/route.ts', import.meta.url), 'utf8');

test('Phase 10 Lane C keeps inventory navigation in the persistent sidebar only', () => {
  assert.doesNotMatch(inventorySource, /inventoryTabs/);
  assert.doesNotMatch(inventorySource, /Điều hướng tồn kho/);
  assert.doesNotMatch(inventorySource, /Về tồn kho/);
  assert.match(inventorySource, /data-testid="inventory-local-controls"/);
  assert.match(inventorySource, /aria-label=\{searchPlaceholder\}/);
});

test('Phase 10 Lane C renders canonical session identity in a compact sidebar footer', () => {
  assert.match(shellSource, /fetch\('\/api\/auth\/me'/);
  assert.match(shellSource, /employeeFullName/);
  assert.match(shellSource, /data-testid="sidebar-current-user-name"/);
  assert.match(shellSource, /userAvatarImage/);
  assert.match(shellSource, /\.finally\(\(\) => \{[\s\S]*?currentUserRequest = null;/);
  assert.match(shellCss, /\.userPlaceholder\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(shellCss, /\.userAvatar\s*\{[\s\S]*?border-radius:\s*50%;/);
  assert.match(authMeSource, /requestNppInternalAuth<MeData>\('\/api\/internal-auth\/me'/);
  assert.doesNotMatch(authMeSource, /roles|permissions|scopes/);
});

test('Phase 10 Lane C animates submenu and route content without display toggles', () => {
  assert.match(shellSource, /className=\{styles\.subnavInner\}/);
  assert.match(shellSource, /aria-expanded=\{childrenVisible\}/);
  assert.match(shellSource, /childrenVisible \? styles\.chevronOpen : ''/);
  assert.match(shellSource, /tabIndex=\{childrenVisible \? undefined : -1\}/);
  assert.doesNotMatch(shellCss, /\.subnav\s*\{[^}]*display:\s*none/);
  assert.match(shellCss, /\.subnav\s*\{[\s\S]*?grid-template-rows:\s*0fr/);
  assert.match(shellCss, /\.subnavOpen\s*\{[\s\S]*?grid-template-rows:\s*1fr/);
  assert.match(shellCss, /overflow-anchor:\s*none/);
  assert.match(shellSource, /<main key=\{pathname\} className=\{styles\.content\}/);
  assert.match(shellCss, /animation:\s*content-enter 150ms ease-out/);
  assert.match(shellCss, /@keyframes content-enter\s*\{[\s\S]*?from \{ opacity: 0\.74; \}[\s\S]*?to \{ opacity: 1; \}/);
  assert.doesNotMatch(shellCss, /@keyframes content-enter\s*\{[\s\S]*?transform:/);
  assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shellCss, /\.content \{ animation: none; \}/);
});

test('Phase 10 Lane C provides wide modal workspace reflow without body horizontal scroll', () => {
  assert.match(modalSource, /'medium' \| 'large' \| 'workspace'/);
  assert.match(modalSource, /data-size=\{size\}/);
  assert.match(modalCss, /\.large\s*\{[\s\S]*?1180px/);
  assert.match(modalCss, /\.workspace\s*\{[\s\S]*?1480px/);
  assert.match(modalCss, /\.large \.body,[\s\S]*?\.workspace \.body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(modalCss, /@media \(max-width: 640px\)/);
  assert.match(modalCss, /\.dialog,\s*\.large,\s*\.workspace\s*\{[^}]*width:\s*100%/);
});
