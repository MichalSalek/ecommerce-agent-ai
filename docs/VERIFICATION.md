# Weryfikacja 2026-11-12

- `npm run typecheck` i `npm run build`: powodzenie, tylko /, /chat, /api/chat.
- `npm audit fix`: 0 podatności po usunięciu zbędnych zależności szablonu.
- Przeglądarka: katalog 18 kart, przejście do czatu, błąd usługi pod 8080 bez zawieszenia.
- Bezpośrednie wykonanie searchProducts: „Szukam czegoś do kawy”, limit 100 zł → 2 produkty.
- Kontrolowana atrapa OpenAI-compatible na porcie 18080, produkcyjny Next na 3001: wywołanie narzędzia przez SDK, 2 karty, potwierdzenie koszyka, wyświetlenie odmowy. Sprawdzono układ mobilny 390 px. Atrapa steruje odpowiedzią; test sprawdza transport i UI, nie rozumowanie modelu.
- Rzeczywisty llama-server niedostępny: pod 8080 odpowiada Adminer HTML. Zachowanie i odmowa rzeczywistego modelu oraz tryb JSON wymagają sprawdzenia po uruchomieniu modelu.
