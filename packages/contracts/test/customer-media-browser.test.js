import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_MEDIA_JPEG_QUALITY,
  CUSTOMER_MEDIA_MAX_IMAGE_BYTES,
  CUSTOMER_MEDIA_MAX_IMAGE_EDGE,
  CUSTOMER_MEDIA_MAX_PHOTOS,
} from '../customer-media-browser.js';

test('customer media browser contract keeps one shared resize policy', () => {
  assert.equal(CUSTOMER_MEDIA_MAX_PHOTOS, 3);
  assert.equal(CUSTOMER_MEDIA_MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(CUSTOMER_MEDIA_MAX_IMAGE_EDGE, 1600);
  assert.equal(CUSTOMER_MEDIA_JPEG_QUALITY, 0.82);
});
