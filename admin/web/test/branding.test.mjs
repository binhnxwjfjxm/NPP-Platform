import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../app/admin-shell.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Admin displays the Hưng Phát logo with an environment override and safe fallback', () => {
  assert.match(shellSource, /NEXT_PUBLIC_APP_LOGO_URL/);
  assert.match(shellSource, /office\.nguyenlieuhungphat\.com\/logo-transparent\.png/);
  assert.match(shellSource, /alt="Logo Hưng Phát Company"/);
  assert.match(shellSource, /className="brandLogoFrame"/);
  assert.match(styleSource, /\.brandLogoFrame/);
  assert.match(styleSource, /\.brandLogo/);
});
