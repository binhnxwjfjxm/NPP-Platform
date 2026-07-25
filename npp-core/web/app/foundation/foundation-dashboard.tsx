'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './foundation.module.css';

interface FoundationStatus {
  apiLive: boolean;
  apiReady: boolean;
  authenticatedContext: {
    actorId: string | null;
    installationId: string | null;
    requestId: string | null;
    sourceApp: string | null;
  };
  sanitizedConfig: {
    nodeEnv: string | null;
    installationId: string | null;
    databaseSslMode: string | null;
    corsOrigins: string[];
  };
  r2State: {
    enabled: boolean;
    contractRouteEnabled: boolean;
    bucketConfigured: boolean;
    publicBaseUrlConfigured: boolean;
    maxObjectBytes: number | null;
    presignedUrlMaxSeconds: number | null;
  };
  r2TestAllowed: boolean;
  checkedAt: string;
}

interface PublicErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
  requestId?: string;
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Not configured';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : date.toLocaleString('vi-VN');
}

function valueOrFallback(value: string | null): string {
  return value?.trim() || 'Not available';
}

function StatusPill({ ok, okLabel, offLabel }: { ok: boolean; okLabel: string; offLabel: string }) {
  return (
    <span className={`${styles.pill} ${ok ? styles.pillOk : styles.pillOff}`}>
      <span className={styles.pillDot} aria-hidden="true" />
      {ok ? okLabel : offLabel}
    </span>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'ok' | 'warn' | 'off';
}) {
  return (
    <article className={styles.summaryCard} data-tone={tone}>
      <div className={styles.summaryIcon} aria-hidden="true"><span /></div>
      <div>
        <p className={styles.eyebrow}>{title}</p>
        <p className={styles.summaryValue}>{value}</p>
        <p className={styles.summaryDetail}>{detail}</p>
      </div>
    </article>
  );
}

export default function FoundationDashboard() {
  const [status, setStatus] = useState<FoundationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [r2Testing, setR2Testing] = useState(false);
  const [r2Message, setR2Message] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/foundation/status', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => ({}))) as FoundationStatus & PublicErrorEnvelope;
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Foundation status is temporarily unavailable');
      }
      setStatus(payload);
    } catch (loadError) {
      setStatus(null);
      setError(loadError instanceof Error ? loadError.message : 'Foundation status is temporarily unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function runR2Test() {
    setR2Testing(true);
    setR2Message(null);
    try {
      const response = await fetch('/api/foundation/r2-test', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => ({}))) as PublicErrorEnvelope;
      if (!response.ok) {
        throw new Error(payload.error?.message || 'R2 contract test failed');
      }
      setR2Message('R2 contract test completed successfully.');
      await loadStatus();
    } catch (testError) {
      setR2Message(testError instanceof Error ? testError.message : 'R2 contract test failed');
    } finally {
      setR2Testing(false);
    }
  }

  const storageAvailable = Boolean(status?.r2State.enabled && status.r2State.contractRouteEnabled);
  const r2ActionVisible = Boolean(storageAvailable && status?.r2TestAllowed);

  return (
    <main className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.frame}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">N</span>
            <div>
              <p className={styles.brandName}>NPP Core</p>
              <p className={styles.brandMeta}>Foundation control</p>
            </div>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.internalBadge}>Internal verification</span>
            <button className={styles.refreshButton} type="button" onClick={() => void loadStatus()} disabled={loading}>
              <span aria-hidden="true" className={loading ? styles.spin : undefined}>↻</span>
              {loading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>Phase 2 · Core foundation</p>
            <h1>NPP Platform readiness</h1>
            <p className={styles.heroCopy}>
              Verify the Core web, API, database, authentication context and private storage boundary from one safe internal view.
            </p>
          </div>
          <div className={styles.lastChecked} data-testid="last-checked">
            <span>Last checked</span>
            <strong>{formatTimestamp(status?.checkedAt ?? null)}</strong>
          </div>
        </section>

        <div className={styles.liveRegion} role="status" aria-live="polite">
          {loading && !status ? 'Loading foundation status…' : ''}
          {error ? `Error: ${error}` : ''}
        </div>

        {error && (
          <section className={styles.errorBanner} data-testid="foundation-error">
            <div><strong>Foundation status unavailable</strong><p>{error}</p></div>
            <button type="button" onClick={() => void loadStatus()}>Try again</button>
          </section>
        )}

        {loading && !status && (
          <section className={styles.loadingGrid} aria-hidden="true">
            {[0, 1, 2, 3].map((item) => <div key={item} className={styles.skeleton} />)}
          </section>
        )}

        {status && (
          <>
            <section className={styles.summaryGrid} aria-label="Foundation summary">
              <SummaryCard title="Core web" value="Loaded" detail="Browser shell is responding" tone="ok" />
              <SummaryCard title="Core API" value={status.apiLive ? 'Operational' : 'Unavailable'} detail="Live health contract" tone={status.apiLive ? 'ok' : 'warn'} />
              <SummaryCard title="Database" value={status.apiReady ? 'Ready' : 'Not ready'} detail="PostgreSQL readiness contract" tone={status.apiReady ? 'ok' : 'warn'} />
              <SummaryCard title="Object storage" value={status.r2State.enabled ? 'Enabled' : 'Disabled'} detail={status.r2State.enabled ? 'Private adapter configured' : 'Expected for CI/local gate'} tone={status.r2State.enabled ? 'ok' : 'off'} />
            </section>

            <section className={styles.contentGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div><p className={styles.eyebrow}>Server-owned identity</p><h2>Authenticated context</h2></div>
                  <StatusPill ok={Boolean(status.authenticatedContext.actorId)} okLabel="Authenticated" offLabel="Unavailable" />
                </div>
                <dl className={styles.definitionList}>
                  <div><dt>Actor ID</dt><dd data-testid="actor-id">{valueOrFallback(status.authenticatedContext.actorId)}</dd></div>
                  <div><dt>Installation ID</dt><dd data-testid="installation-id">{valueOrFallback(status.authenticatedContext.installationId)}</dd></div>
                  <div><dt>Source app</dt><dd data-testid="source-app">{valueOrFallback(status.authenticatedContext.sourceApp)}</dd></div>
                  <div><dt>Request ID</dt><dd className={styles.mono}>{valueOrFallback(status.authenticatedContext.requestId)}</dd></div>
                </dl>
              </article>

              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div><p className={styles.eyebrow}>Safe runtime view</p><h2>Sanitized configuration</h2></div>
                  <StatusPill ok={status.apiReady} okLabel="Verified" offLabel="Degraded" />
                </div>
                <dl className={styles.definitionList}>
                  <div><dt>Node environment</dt><dd>{valueOrFallback(status.sanitizedConfig.nodeEnv)}</dd></div>
                  <div><dt>Installation</dt><dd>{valueOrFallback(status.sanitizedConfig.installationId)}</dd></div>
                  <div><dt>Database SSL mode</dt><dd>{valueOrFallback(status.sanitizedConfig.databaseSslMode)}</dd></div>
                  <div><dt>Allowed origins</dt><dd>{status.sanitizedConfig.corsOrigins.length || 0} configured</dd></div>
                </dl>
              </article>

              <article className={`${styles.panel} ${styles.storagePanel}`}>
                <div className={styles.panelHeader}>
                  <div><p className={styles.eyebrow}>Private by default</p><h2>Cloudflare R2 boundary</h2></div>
                  <StatusPill ok={status.r2State.enabled} okLabel="Adapter enabled" offLabel="Adapter disabled" />
                </div>
                <div className={styles.storageGrid}>
                  <div><span>Contract route</span><strong>{status.r2State.contractRouteEnabled ? 'Enabled' : 'Disabled'}</strong></div>
                  <div><span>Bucket configured</span><strong>{status.r2State.bucketConfigured ? 'Yes' : 'No'}</strong></div>
                  <div><span>Maximum object</span><strong>{formatBytes(status.r2State.maxObjectBytes)}</strong></div>
                  <div><span>Maximum signed URL TTL</span><strong>{status.r2State.presignedUrlMaxSeconds === null ? 'Not configured' : `${status.r2State.presignedUrlMaxSeconds}s`}</strong></div>
                </div>
                <p className={styles.securityNote}>Credentials, bucket names, provider endpoints, database URLs and signed URLs are intentionally excluded.</p>
                {r2ActionVisible && (
                  <button className={styles.secondaryButton} type="button" onClick={() => void runR2Test()} disabled={r2Testing}>
                    {r2Testing ? 'Running contract test…' : 'Run R2 contract test'}
                  </button>
                )}
                {r2Message && <p className={styles.actionMessage} role="status">{r2Message}</p>}
              </article>
            </section>
          </>
        )}

        <footer className={styles.footer}>
          <span>Internal diagnostic surface · disabled by default</span>
          <span>No production provider action is triggered on page load</span>
        </footer>
      </div>
    </main>
  );
}
