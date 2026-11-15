/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  distDir:
    process.env.NODE_ENV === "development" ? ".next-development" : ".next",
  devIndicators: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/onnxruntime-node/**/*",
      "./node_modules/onnxruntime-common/**/*",
    ],
  },
  serverExternalPackages: [
    "@lancedb/lancedb",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  async headers() {
    return [
      ...["/", "/chat", "/cart", "/products/:id"].map(source => ({
        source, headers: [{ key: "Cloudflare-CDN-Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400" }],
      })),
      { source: "/images/:path*", headers: [
      { key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800" },
    ] }];
  },
  images: {
    // Catalog photos are already WebP. Runtime AVIF encoding on Render Free
    // delayed uncached images and competed with CPU embeddings for memory.
    unoptimized: true,
  },
};

export default nextConfig;
