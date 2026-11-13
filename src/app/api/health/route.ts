export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cheap liveness only. It deliberately does not wake the model or index the catalog.
export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "aurelle",
      revision:
        process.env.RENDER_GIT_COMMIT ?? process.env.APP_REVISION ?? "local",
      embeddingProfile: process.env.EMBEDDING_MODEL ?? "bge",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
