/** @type {import('next').NextConfig} */
const nextConfig = {
  // §1/P2 — the API is one layer; the web client is another. They share zod schemas via @kafil/core.
  transpilePackages: ['@kafil/core'],
  experimental: {
    typedRoutes: true,
  },
  // Surface server crashes loudly in dev.
  reactStrictMode: true,
};
export default nextConfig;
