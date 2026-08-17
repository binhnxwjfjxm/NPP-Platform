const foundationTestUiEnabled = process.env.FOUNDATION_TEST_UI_ENABLED === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: foundationTestUiEnabled ? '.next-foundation' : '.next',
  async redirects() {
    return [
      {
        source: '/accounting/cod-reconciliation',
        destination: '/accounting/cod-reporting?tab=accounting',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
