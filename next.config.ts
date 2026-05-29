import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async redirects() {
    // Only redirect to waitlist in production (on tonkl.com)
    if (process.env.NODE_ENV === "production") {
      return [
        {
          source: "/",
          destination: "/waitlist",
          permanent: false,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
