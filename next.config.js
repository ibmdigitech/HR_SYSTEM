/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase body size limit for Server Actions
  // Note: In Next.js 16.1.1, we need to use experimental.serverActions
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb', // Default is 1mb, increase to 2mb
    },
  },
};

module.exports = nextConfig;