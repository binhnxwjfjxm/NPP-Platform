const foundationTestUiEnabled = process.env.FOUNDATION_TEST_UI_ENABLED === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: foundationTestUiEnabled ? '.next-foundation' : '.next',
};

export default nextConfig;
