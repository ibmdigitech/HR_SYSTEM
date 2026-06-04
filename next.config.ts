import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Absolute path to project root to avoid distDirRoot issues
    root: path.resolve(__dirname),
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
