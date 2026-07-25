import { NextRequest, NextResponse } from 'next/server';

interface HealthLiveResponse {
  ok: boolean;
  timestamp?: string;
}

interface HealthAuthenticatedResponse {
  ok: boolean;
  context?: {
    actorId?: string;
    installationId?: string;
    requestId?: string;
    permissions?: Record<string, boolean>;
  };
}

export const GET = async (request: NextRequest) => {
  // Check if foundation UI is enabled
  const foundationEnabled = process.env.FOUNDATION_TEST_UI_ENABLED === 'true';
  if (!foundationEnabled) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  try {
    const coreApiUrl = process.env.CORE_API_INTERNAL_URL || 'http://127.0.0.1:3004';
    const coreApiToken = process.env.CORE_API_SERVER_TOKEN || 'test-token';

    // Fetch Core API health/live status
    const liveResponse = await fetch(`${coreApiUrl}/health/live`, {
      headers: {
        Authorization: `Bearer ${coreApiToken}`,
      },
    });
    const liveData: HealthLiveResponse = liveResponse.ok ? await liveResponse.json() : { ok: false };

    // Fetch Core API health/ready status
    const readyResponse = await fetch(`${coreApiUrl}/health/ready`, {
      headers: {
        Authorization: `Bearer ${coreApiToken}`,
      },
    });
    const readyData: HealthLiveResponse = readyResponse.ok ? await readyResponse.json() : { ok: false };

    // Fetch Core API health/authenticated to get context without leaking auth
    const authResponse = await fetch(`${coreApiUrl}/health/authenticated`, {
      headers: {
        Authorization: `Bearer ${coreApiToken}`,
      },
    });
    const authData: HealthAuthenticatedResponse = authResponse.ok ? await authResponse.json() : { ok: false };

    // Extract safe context (no secrets)
    const context = authData.context || {};

    // Build sanitized response
    const status = {
      apiLive: liveData.ok,
      apiReady: readyData.ok,
      authenticatedContext: {
        actorId: context.actorId,
        installationId: context.installationId,
        requestId: context.requestId,
      },
      sanitizedConfig: {
        nodeEnv: process.env.NODE_ENV || 'development',
        serverPort: process.env.PORT || '3003',
        installationId: process.env.NEXT_PUBLIC_INSTALLATION_ID || context.installationId,
      },
      r2State: {
        enabled: process.env.FOUNDATION_R2_TEST_ENABLED === 'true',
      },
      serverTimestamp: new Date().toISOString(),
    };

    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Failed to fetch foundation status',
        details: message,
        apiLive: false,
        apiReady: false,
        authenticatedContext: {},
        sanitizedConfig: {
          nodeEnv: process.env.NODE_ENV || 'development',
          serverPort: process.env.PORT || '3003',
        },
        r2State: {
          enabled: false,
        },
        serverTimestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
};
