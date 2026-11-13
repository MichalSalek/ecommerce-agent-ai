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
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
