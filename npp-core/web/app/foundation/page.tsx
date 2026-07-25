'use client';

import { useEffect, useState } from 'react';

interface FoundationStatus {
  apiLive: boolean;
  apiReady: boolean;
  authenticatedContext: {
    actorId?: string;
    installationId?: string;
    requestId?: string;
  };
  sanitizedConfig: {
    nodeEnv: string;
    serverPort: string;
    installationId?: string;
  };
  r2State: {
    enabled: boolean;
  };
  serverTimestamp: string;
}

export default function FoundationPage() {
  const [status, setStatus] = useState<FoundationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch foundation status from server-side gateway
    fetch('/api/foundation/status')
      .then((res) => {
        if (res.status === 404) {
          setError('Foundation UI is not enabled in this environment');
          return null;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setStatus(data);
        }
      })
      .catch((err) => {
        setError(`Failed to load foundation status: ${err.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-gray-600">Loading foundation status...</div>;
  }

  if (error) {
    return <div className="p-8 text-red-600">{error}</div>;
  }

  if (!status) {
    return <div className="p-8 text-red-600">Foundation status is not available</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">NPP Core — Foundation Status</h1>

      {/* API Status Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Core API Status</h2>
        <div className="space-y-2 bg-gray-100 p-4 rounded">
          <p>
            <strong>Live:</strong>
            <span className={`ml-2 ${status.apiLive ? 'text-green-600' : 'text-red-600'}`}>
              {status.apiLive ? '✓ Yes' : '✗ No'}
            </span>
          </p>
          <p>
            <strong>Ready:</strong>
            <span className={`ml-2 ${status.apiReady ? 'text-green-600' : 'text-red-600'}`}>
              {status.apiReady ? '✓ Yes' : '✗ No'}
            </span>
          </p>
        </div>
      </section>

      {/* Authenticated Context Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Authenticated Context</h2>
        <div className="space-y-2 bg-gray-100 p-4 rounded font-mono text-sm">
          <p>
            <strong>Actor ID:</strong> {status.authenticatedContext.actorId || '(not set)'}
          </p>
          <p>
            <strong>Installation ID:</strong> {status.authenticatedContext.installationId || '(not set)'}
          </p>
          <p>
            <strong>Request ID:</strong> {status.authenticatedContext.requestId || '(not set)'}
          </p>
        </div>
      </section>

      {/* Sanitized Config Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Sanitized Configuration</h2>
        <div className="space-y-2 bg-gray-100 p-4 rounded font-mono text-sm">
          <p>
            <strong>Node Environment:</strong> {status.sanitizedConfig.nodeEnv}
          </p>
          <p>
            <strong>Server Port:</strong> {status.sanitizedConfig.serverPort}
          </p>
          {status.sanitizedConfig.installationId && (
            <p>
              <strong>Installation ID:</strong> {status.sanitizedConfig.installationId}
            </p>
          )}
        </div>
      </section>

      {/* R2 State Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Object Storage (R2)</h2>
        <div className="space-y-2 bg-gray-100 p-4 rounded">
          <p>
            <strong>Enabled:</strong>
            <span className={`ml-2 ${status.r2State.enabled ? 'text-green-600' : 'text-yellow-600'}`}>
              {status.r2State.enabled ? '✓ Yes' : '○ Disabled (expected in CI)'}
            </span>
          </p>
          <p className="text-sm text-gray-600 mt-2">
            (Credentials, bucket, endpoint, and signed URLs are never exposed to browser)
          </p>
        </div>
      </section>

      {/* Server Timestamp Section */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Server Timestamp</h2>
        <div className="space-y-2 bg-gray-100 p-4 rounded font-mono text-sm">
          <p>{new Date(status.serverTimestamp).toISOString()}</p>
        </div>
      </section>

      {/* Security Note */}
      <section className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded">
        <p className="text-sm text-blue-800">
          <strong>ℹ️ Security Note:</strong> This page is for internal testing only. All sensitive information (tokens, database URLs, R2 credentials, signed URLs) are strictly hidden. The data shown here is sanitized and safe to log/share.
        </p>
      </section>
    </div>
  );
}
