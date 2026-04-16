import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
