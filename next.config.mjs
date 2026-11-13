/** @type {import('next').NextConfig} */
const nextConfig = {
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
