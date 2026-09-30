const SETTING_NAME_PATTERN = /^npp\.[a-z0-9_.-]{1,120}$/;

export async function withTransactionLocalSetting(client, settingName, value, operation) {
  if (!client || typeof client.query !== 'function') throw new Error('invalid_db_client');
  if (!SETTING_NAME_PATTERN.test(String(settingName ?? ''))) {
    throw new Error('invalid_transaction_local_setting_name');
  }
  if (typeof operation !== 'function') throw new Error('invalid_transaction_local_setting_operation');

  const previousResult = await client.query(
    'SELECT current_setting($1, true) AS value',
    [settingName],
  );
  const previousValue = previousResult.rows?.[0]?.value ?? '';

  await client.query(
    'SELECT set_config($1, $2, true)',
    [settingName, String(value ?? '')],
  );

  // Restore only after success. If PostgreSQL already aborted the transaction,
  // an extra cleanup query would hide the original error behind 25P02.
  const result = await operation();

  await client.query(
    'SELECT set_config($1, $2, true)',
    [settingName, previousValue],
  );
  return result;
}
