import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(new URL('../src/routes/logistics-driver.js', import.meta.url), 'utf8');

test('Delivery customer media read is scoped to the assigned trip before canonical customer media is resolved', () => {
  assert.match(routeSource, /const mediaMatch = pathname\.match/);
  assert.match(routeSource, /readDriverCustomerMedia\(res, options, requestContext, mediaMatch\[1\], mediaMatch\[2\]\)/);
  assert.match(routeSource, /getAssignedDriverTrip\(options\.getPool\(\), \{ requestContext, tripId \}\)/);
  assert.match(routeSource, /tripResult\.trip\.stops[\s\S]*some[\s\S]*stop\.customerId/);
  assert.match(routeSource, /DELIVERY_CUSTOMER_NOT_FOUND/);
  assert.match(routeSource, /listReadyCustomerMedia[\s\S]*installationId: requestContext\.installationId[\s\S]*customerId/);
});

test('Delivery customer media returns short-lived view URLs only and never mutates or snapshots them', () => {
  assert.match(routeSource, /createOptionalR2StorageAdapter/);
  assert.match(routeSource, /CUSTOMER_MEDIA_VIEW_TTL_SECONDS = 300/);
  assert.match(routeSource, /createPresignedGetUrl/);
  assert.match(routeSource, /customerMediaPublic\(item, signed\.url\)/);
  assert.doesNotMatch(routeSource, /prepareCoreCustomerMedia|finalizeCoreCustomerMedia|INSERT INTO shared\.customer_media|UPDATE shared\.customer_media/);
  assert.doesNotMatch(routeSource, /destinationSnapshot|addressSnapshot|signedUrlSnapshot|viewUrlSnapshot/);
});

test('Missing photos are a successful empty read instead of a delivery blocker', () => {
  assert.match(routeSource, /mediaResult\.media\.length === 0[\s\S]*writeSuccess\(res, \{ media: \[\], maxPhotos: mediaResult\.maxPhotos \}/);
});
