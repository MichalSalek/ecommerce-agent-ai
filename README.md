# Aurelle — demo sklepu z agentem AI

Next.js 16, React 19, TypeScript strict, Tailwind i AI SDK 7. Źródło szablonu: https://github.com/dilums/kimi-k3-ecommerce-storefront (zachowane zdjęcia produktów i historia Git).

## Uruchomienie

```bash
cd /home/ms/ecommerce-agent-ai/storefront
npm install
# W drugim terminalu, z własnym plikiem modelu:
llama-server -m /ścieżka/model.gguf --host 127.0.0.1 --port 8080 --jinja
curl http://127.0.0.1:8080/v1/models
npm run dev
```

Otwórz http://localhost:3000 i http://localhost:3000/chat (jeśli port jest zajęty, Next wypisze wybrany port). Model jest wykrywany przez `/v1/models`; bez kluczy API. Model i szablon czatu llama.cpp muszą obsługiwać narzędzia (np. odpowiednia wersja Qwen). Port 8080 musi należeć do llama-server.

Opcjonalne zmienne w `.env.local`:

```dotenv
LLAMA_BASE_URL=http://127.0.0.1:8080/v1
# LLAMA_MODEL=nazwa-z-v1-models
# LLAMA_TOOL_MODE=json
```

`LLAMA_TOOL_MODE=json` uruchamia uproszczoną, walidowaną pętlę JSON, maksymalnie 5 kroków, bez natywnego function callingu. Model musi umieć przestrzegać formatu JSON. Domyślnie działa ToolLoopAgent. Oba tryby mają limit 60 sekund i nie ponawiają automatycznie zapytań. Kontrola modelu ma limit 4 sekund. Przerwanie w czacie anuluje żądanie. Błędy są pokazywane obok formularza.

## Sprawdzenie

```bash
npm run typecheck
npm run build
```

W czacie: „Szukam czegoś do kawy” powinno wywołać `searchProducts` i pokazać karty. „Napisz pętlę w Pythonie” powinno spowodować odmowę. Są to zachowania wymagające sprawdzenia z rzeczywistym uruchomionym modelem; instrukcja systemowa nie gwarantuje posłuszeństwa każdego modelu.

Wszystkie dane i polityki są demonstracyjne. Przycisk koszyka zapisuje `[CART]` w konsoli i pokazuje potwierdzenie, bez zamówienia. Serwer loguje `[AGENT]`, `[LLM]`, `[TOOL]`. W AI SDK 7 wiadomości używają `parts` i stanów `output-available`, a `useChat` używa `sendMessage` i `status` zamiast dawnego `toolInvocations`/`handleSubmit`.

## Pliki aplikacji

- `src/data/products.ts` — 18 produktów, lokalne zdjęcia.
- `src/types/shop.ts` — Product, ChatMessage, ToolInvocation.
- `src/lib/agent.ts` — model, instrukcje i trzy narzędzia.
- `src/app/api/chat/route.ts` — walidacja, streaming, JSON fallback i błędy.
- `src/components/ProductCard.tsx` — wspólne karty i koszyk demo.
- `src/app/page.tsx` — pełny katalog.
- `src/app/chat/page.tsx` — czat.
- `src/app/layout.tsx`, `src/app/globals.css` — wspólny układ i style.

Usunięto pozostałe trasy i komponenty szablonu wymagające rozbudowanych przepływów. Brak bazy danych, płatności i usług chmurowych.

## Podłączony Bielik (WSL → Windows)

W tej instalacji `.env.local` wskazuje llama-swap działający w Windows:

```dotenv
LLAMA_BASE_URL=http://172.20.0.1:8090/v1
LLAMA_MODEL=bielik-pl
LLAMA_TOOL_MODE=json
```

Adres `172.20.0.1` jest bieżącą bramą WSL (`ip route show default`); po zmianie sieci WSL może wymagać aktualizacji. Windowsowy panel modeli: http://localhost:8090/ui/#/models. Plik `.env.local` jest lokalny i nie trafia do Git. Po zmianie konfiguracji ponownie uruchom `npm run dev`.

Bielik korzysta z wymuszonego schematu JSON: najpierw wybiera narzędzie lub odmowę, następnie otrzymuje rzeczywiste dane i generuje odpowiedź. Tryb nie zmienia ustawień rozumowania serwera.
