import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { products } from "@/data/products";

export const baseURL = process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080/v1";
const llamaCpp = createOpenAICompatible({
  name: "llama.cpp",
  baseURL,
  apiKey: "not-needed",
});
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
export const tools = {
  searchProducts: tool({
    description:
      "Wyszukaj produkty sklepu po nazwie, opisie lub kategorii i opcjonalnej cenie maksymalnej w PLN.",
    inputSchema: z.object({
      query: z.string().max(300),
      maxPrice: z.number().nonnegative().optional(),
    }),
    execute: async ({ query, maxPrice }) => {
      console.log("[TOOL] searchProducts wywołane z:", { query, maxPrice });
      const words = normalize(query)
        .split(/\s+/)
        .filter(
          (w) =>
            w.length > 2 &&
            !["szukam", "czegos", "cos", "prosze", "produkt", "chce"].includes(
              w,
            ),
        )
        .map((w) => (w.startsWith("kaw") ? "kaw" : w));
      const result = products.filter(
        (p) =>
          (maxPrice === undefined || p.price <= maxPrice) &&
          (!words.length ||
            words.some((w) =>
              normalize(`${p.name} ${p.description} ${p.category}`).includes(w),
            )),
      );
      console.log(`[TOOL] wynik: ${result.length} produktów`);
      return result;
    },
  }),
  getProductDetails: tool({
    description:
      "Pobierz opis, cenę i dostępność produktu według jego identyfikatora.",
    inputSchema: z.object({ productId: z.string().max(100) }),
    execute: async ({ productId }) => {
      console.log("[TOOL] getProductDetails wywołane z:", { productId });
      const product = products.find((p) => p.id === productId);
      console.log("[TOOL] wynik:", product ? "znaleziono" : "brak");
      return product ?? { error: "Nie znaleziono produktu." };
    },
  }),
  getPolicy: tool({
    description:
      "Sprawdź demonstracyjne zasady dostawy, zwrotów lub płatności.",
    inputSchema: z.object({ topic: z.string().max(200) }),
    execute: async ({ topic }) => {
      console.log("[TOOL] getPolicy wywołane z:", { topic });
      const t = normalize(topic);
      const result = /zwrot/.test(t)
        ? "W demo zakładamy 14 dni na zwrot od odbioru."
        : /dostaw|wysyl/.test(t)
          ? "W demo dostawa kosztuje 15 zł i trwa 2–3 dni robocze."
          : /plat/.test(t)
            ? "To demo nie przyjmuje płatności ani zamówień."
            : "Dostępne tematy: dostawa, zwroty, płatności.";
      console.log("[TOOL] wynik: polityka sklepu");
      return result;
    },
  }),
};
export const instructions = `Jesteś asystentem sklepu Aurelle. Pomagasz klientom w wyborze produktów, odpowiadasz na pytania o dostawę, zwroty i dostępność.
ZASADY:
- Odpowiadaj WYŁĄCZNIE na pytania związane z tym sklepem i jego ofertą.
- Jeśli użytkownik poprosi o coś spoza tematu (np. napisanie kodu, przepis kulinarny, poradę prawną), uprzejmie odmów i zaproponuj powrót do zakupów.
- Nie udzielaj porad medycznych, prawnych ani finansowych.
- Mów zwięźle i pomocnie, po polsku.
- Zawsze używaj narzędzi do sprawdzania oferty, ceny, dostępności i polityk. Nie wymyślaj danych. Zapytanie do wyszukiwarki skracaj do słów kluczowych, np. kawa. Ceny w PLN. To demo, nie składasz zamówień.`;
export async function resolveModel(signal: AbortSignal) {
  try {
    const response = await fetch(`${baseURL}/models`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) throw new Error("HTTP");
    const body: unknown = await response.json();
    const parsed = z
      .object({ data: z.array(z.object({ id: z.string().min(1) })).min(1) })
      .parse(body);
    const id = process.env.LLAMA_MODEL ?? parsed.data[0].id;
    console.log("[LLM] lokalny model:", id);
    return llamaCpp(id);
  } catch {
    throw new Error(
      `Nie można połączyć z llama-server pod ${baseURL}. Uruchom llama-server z modelem obsługującym narzędzia. Sprawdź, czy port nie jest zajęty przez inną usługę.`,
    );
  }
}
export function createAgent(model: Awaited<ReturnType<typeof resolveModel>>) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    stopWhen: stepCountIs(5),
    maxRetries: 0,
  });
}
