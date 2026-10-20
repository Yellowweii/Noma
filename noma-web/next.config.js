/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false,
  async headers() {
    return [{ source: "/login/:path*", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] }];
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }] },
};
module.exports = nextConfig;
