import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';

async function main() {
  const config = loadConfig();
  const pool = getPool(config);
  try {
    const result = await pool.query(`
      SELECT anomaly_type, count(*)::bigint AS anomaly_count
        FROM reporting.phase6f_closeout_anomalies
       WHERE installation_id = $1
       GROUP BY anomaly_type
       ORDER BY anomaly_type
    `, [config.installationId]);
    const anomalies = result.rows.map((row) => ({ type: row.anomaly_type, count: String(row.anomaly_count) }));
    const anomalyCount = anomalies.reduce((total, item) => total + Number(item.count), 0);
    process.stdout.write(`${JSON.stringify({
      installationId: config.installationId,
      checkedAt: new Date().toISOString(),
      anomalyCount,
      anomalies,
      status: anomalyCount === 0 ? 'matched' : 'mismatch',
    }, null, 2)}\n`);
    if (anomalyCount > 0) process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    code: error?.code ?? 'PHASE6F_RECONCILIATION_FAILED',
    message: 'Phase 6F reconciliation could not be completed',
  })}\n`);
  process.exitCode = 1;
});
