import { NextRequest, NextResponse } from 'next/server';

export const POST = async (request: NextRequest) => {
  // Check if foundation UI and R2 test are enabled
  const foundationEnabled = process.env.FOUNDATION_TEST_UI_ENABLED === 'true';
  const r2TestEnabled = process.env.FOUNDATION_R2_TEST_ENABLED === 'true';

  if (!foundationEnabled) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!r2TestEnabled) {
    return NextResponse.json(
      {
        testRan: false,
        reason: 'R2 test is disabled by default in CI and local development',
        enabled: false,
      },
      { status: 200 }
    );
  }

  try {
    const coreApiUrl = process.env.CORE_API_INTERNAL_URL || 'http://127.0.0.1:3004';
    const coreApiToken = process.env.CORE_API_SERVER_TOKEN || 'test-token';

    // Test R2 presign endpoint
    const r2Response = await fetch(`${coreApiUrl}/api/storage/r2/presign-put`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${coreApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: 'test/foundation-test.txt',
        contentType: 'text/plain',
      }),
    });

    if (!r2Response.ok) {
      const errorText = await r2Response.text();
      return NextResponse.json(
        {
          testRan: true,
          success: false,
          statusCode: r2Response.status,
          error: 'R2 presign endpoint returned error',
          // Never include the actual error details or any credentials
        },
        { status: 200 }
      );
    }

    const r2Data = await r2Response.json();

    // Return only safe test results (no signed URLs, no credentials)
    return NextResponse.json({
      testRan: true,
      success: true,
      presignEnabled: true,
      message: 'R2 presign endpoint is working',
      // Don't expose the actual signed URL or any credentials
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        testRan: true,
        success: false,
        error: 'Failed to test R2 presign endpoint',
        reason: message,
      },
      { status: 200 }
    );
  }
};
