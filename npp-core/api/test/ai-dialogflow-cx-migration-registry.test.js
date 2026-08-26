import assert from 'node:assert/strict';
import test from 'node:test';

import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

test('canonical migration registry includes Dialogflow CX request billing migration 113', () => {
  const ids = CORE_API_MIGRATIONS.map(({ id }) => id);

  assert.ok(ids.includes('111_ai_usage_metering'));
  assert.ok(ids.includes('112_ai_website_anonymous_usage'));
  assert.ok(ids.includes('113_ai_dialogflow_cx_request_billing'));
  assert.ok(
    ids.indexOf('112_ai_website_anonymous_usage')
      < ids.indexOf('113_ai_dialogflow_cx_request_billing'),
    '113 must remain canonically after 112',
  );
});
