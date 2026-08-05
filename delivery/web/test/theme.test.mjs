import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-mobile.css');
const experience = read('app/delivery-app-experience.css');
const layout = read('app/layout.tsx');
const frame = read('app/DeliveryAppFrame.tsx');
const home = read('app/page.tsx');
const trip = read('app/trips/[tripId]/page.tsx');

const tokens = {
  '--hp-canvas': '#f7f5f1',
  '--hp-bronze': '#98600f',
  '--hp-bronze-strong': '#754706',
  '--hp-ink': '#2d2924',
  '--hp-border': '#d8d0c4',
};

test('Delivery uses the shared warm-gold palette', () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(theme, new RegExp(`${name}:\\s*${value}`, 'i'));
  }
});

test('Delivery is a stable mobile application shell with one scroll region', () => {
  assert.match(layout, /DeliveryAppFrame/);
  assert.match(layout, /import '\.\/delivery-app-experience\.css';/);
  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(layout, /themeColor:\s*'#754706'/);
  assert.match(frame, /data-delivery-app-frame/);
  assert.match(frame, /deliveryAppTopBar/);
  assert.match(frame, /deliveryAppDock/);
  assert.match(frame, /#next-delivery-action/);
  assert.match(experience, /height:\s*100dvh/);
  assert.match(experience, /grid-template-rows:\s*auto minmax\(0, 1fr\) calc\(78px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(experience, /\.deliveryAppContent[\s\S]*?overflow-y:\s*auto/);
  assert.match(experience, /\.deliveryDockPrimary/);
});

test('Delivery prioritizes active trip, next stop and result action', () => {
  assert.match(home, /const \[activeTrip, \.\.\.remainingTrips\]/);
  assert.match(home, /id="active-trip"/);
  assert.match(home, /primaryTripCard/);
  assert.match(home, /Mở điểm tiếp theo và ghi kết quả/);
  assert.match(trip, /const nextStop =/);
  assert.match(trip, /const nextAssignment =/);
  assert.match(trip, /id="next-delivery-action"/);
  assert.match(trip, /nextStopCard/);
  assert.match(trip, /Ghi kết quả giao hàng/);
  assert.match(trip, /id=\{assignmentAnchor\(assignment\.assignmentId\)\}/);
});

test('Delivery focus ring has an opaque edge for light and dark surfaces', () => {
  assert.match(theme, /--hp-focus-inner:\s*#fffdf8/i);
  assert.match(theme, /--hp-focus-outer:\s*#754706/i);
  assert.match(theme, /outline:\s*2px solid var\(--hp-focus-inner\)/);
  assert.match(theme, /box-shadow:\s*0 0 0 4px var\(--hp-focus-outer\)/);
});
