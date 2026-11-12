/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@lancedb/lancedb", "@huggingface/transformers", "onnxruntime-node"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
