// Production: static export (served by the Python server from web/out).
// Development: `npm run dev` proxies /api to the Python server on :8000.
const isProd = process.env.NODE_ENV === "production";

const config = isProd
  ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
  : {
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${process.env.API_URL || "http://localhost:8000"}/api/:path*` }];
      },
    };

export default config;
