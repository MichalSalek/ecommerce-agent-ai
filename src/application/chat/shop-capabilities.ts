/** The same shop boundaries are visible to each model stage and to capability validation. */
export const shoppingCapabilities = {
  operations: [
    "Find and refine Aurelle products by need, budget in EUR and availability. Inspect one product or compare identified products.",
    "Read Aurelle's delivery, return and payment policies.",
    "Read the supplied cart snapshot and propose adding products when the shopper asks. Their browser confirms saving to its local cart.",
  ],
  limits: [
    "The shop uses authored demo data. There is no external store or web search, customer account, order history, shipment tracking, checkout, payment processing or order placement.",
    "An unlisted specification is unknown. Do not infer absence, quantity, suitability or certification from silence or a photograph.",
  ],
} as const;

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ł", "l");

export type CapabilityTopic = "sources" | "technology" | "external" | "accounts" | "orders" | "sessions" | "identity" | "catalogAccess" | "unprovidedBudget";
export function capabilityTopic(request: string, freshConversation = false): CapabilityTopic | undefined {
  const text = fold(request);
  if (freshConversation && /\b(?:budzet\w*|budget)\b/.test(text) &&
      /\b(?:pamietasz|przypomnij|wczesniejsz\w*|poprzedni\w*|podal\w*|remember|recall|earlier|previous|did i (?:give|mention|say))\b/.test(text) && !/\d/.test(text)) return "unprovidedBudget";
  if (/\b(?:kim jestem|moje imie|moj zawod|who i am|my (?:name|profession|job)|what i do for (?:a living|work))\b/.test(text)) return "identity";
  if (/\b(?:lancedb|vector database|database|jakiej bazie|bazy danych|techniczna stron\w*|silnik wyszuk\w*)\b/.test(text)) return "technology";
  if (/\b(?:kont(?:a|o|ach)|accounts?|order history|histor\w* zamowien)\b/.test(text)) return "accounts";
  if (/\b(?:poprzedni\w* (?:sesj\w*|wizyt\w*|czat\w*)|past visits?|previous (?:sessions?|visits?|chats?))\b/.test(text)) return "sessions";
  if (/\b(?:innym sklepie|innych sklepow|innego sklepu|another (?:shop|store)|other (?:shops|stores)|external)\b/.test(text)) return "external";
  if (/\b(?:zaplac\w*|(?:moje|mojego) zamowieni\w*|sledz\w*|track\w*|checkout|pay|place an order)\b/.test(text)) return "orders";
  if (/\b(?:co widzisz.{0,50}(?:gdy|kiedy|jesli) (?:pytam|zapytam)|what (?:can |do )?you see.{0,35}when i ask)\b/.test(text) ||
      /\b(?:(?:jakie dane|jakie informacje) (?:widzisz|masz)|what (?:data|information) (?:do|can) you)\b.{0,60}\b(?:produkt\w*|product\w*|katalog\w*|catalog\w*|cen\w*|pric\w*|stock)\b/.test(text) ||
      /\b(?:skad (?:bierzesz|znasz|masz|pochodz\w*)|where do you get)\b.{0,60}\b(?:cen\w*|dostepnos\w*|pric\w*|stock)\b/.test(text)) return "catalogAccess";
  if (/\b(?:skad|zrodl\w*|informacje o produktach|kim jestes|kto mi .{0,8}odpowiada|obslug\w*|source\w*|where.*(?:data|information)|who are you)\b/.test(text)) return "sources";
}

const topicInstructions: Record<CapabilityTopic, string> = {
  unprovidedBudget: "This fresh conversation contains no earlier budget. Say that the shopper has not given a budget in this conversation and ask what limit they would like. Do not guess an amount.",
  catalogAccess: "Answer the specific question about what you can see. When asked how you know a price or stock, say that you read it from Aurelle’s catalog, the same record shown on the product page. Only mention search technology if explicitly requested.",
  identity: "You know only what the visitor told you in the current conversation. Answer the personal question immediately. If they ask whether you know their name or occupation, explicitly say whether they have told you their name or occupation in this conversation. If they gave one, acknowledge exactly that detail. Do not introduce yourself unless asked about yourself.",
  sources: "If answering about your role or source, identify yourself as Aurelle's shopping assistant, credit the same shop catalog as the product pages and address what help was requested.",
  technology: "This is an explicit technical question. Explain the roles of LanceDB search and the canonical store record that supplies a product's price and stock.",
  external: "Address the other seller explicitly: you cannot inspect its inventory or transfer its product. You may offer to look for a comparable item in Aurelle if the shopper wants it.",
  accounts: "Address personal data explicitly: you cannot see customer accounts or other stores' orders. Only mention this conversation or device cart if useful.",
  orders: "Answer the requested transaction or tracking question directly: Aurelle is a demo, cannot take a real payment or place an order, and has no shipment to track. Ordinary shipping or returns terms come from the policy tool.",
  sessions: "Address which conversation you can see: only the supplied current thread and device cart. You cannot retrieve past visits, closed conversations or real orders.",
};
export function specificCapabilityInstructions(topic?: CapabilityTopic): string {
  return topic ? "For a question about your own role or access: " + topicInstructions[topic] + " Answer CURRENT in your own words. A specific product or policy question still requires its own source." : "";
}

/** Validate the assistant's perspective and the limitations of this demo. */
export function capabilityAnswerError(text: string, language: "pl" | "en", requireFirstPerson = false): string | undefined {
  const folded = fold(text);
  if ((language === "pl" && /\bmozesz mi pomoc\b/.test(folded)) ||
      (language === "en" && /\byou can help me\b/.test(folded)) ||
      (requireFirstPerson && !(language === "pl" ? /\b(?:moge|pomoge|mam|widze|korzystam|pomagam|opieram|doradzam|sprawdzam|pracuje|dzialam|jestem|odpowiadam|znam|nie przyjmuje|nie skladam|nie sledze|nie realizuje|nie przyjmuje platnosci)\b/ : /\b(?:i am|i have|i see|i can|i will|i work|i use|i rely|i help|i check|i don.t|i cannot|i can.t|i'm|i'll)\b/).test(folded)))
    return "Speak as the assistant in the first person, addressing the customer.";
  const externalAccess = /\b(?:i (?:can )?(?:access|look up|browse|search|check|track)|(?:moge |potrafie )?(?:sprawdzac|przeszukiwac|przegladac|sledzic)|mam dostep do)\b.{0,45}\b(?:other stores?|other shops?|other websites?|your account|your order history|zewnetrzn\w* stron\w*|innych sklepow|twojego konta|historii zamowien)\b/;
  const unsupported = /\b(?:place (?:an? |the )?order|track (?:an? |the )?order|checkout|book (?:a |an )?(?:delivery|appointment)|apply (?:a |an )?(?:discount|promo)|realizowac zamowieni\w*|skladac zamowieni\w*|sledzic (?:twoje )?zamowieni\w*|rezerwowac dostawe|naliczac rabat\w*)\b/;
  const denial = /\b(?:cannot|can't|do not|don't|does not|doesn't|no|nie|bez)\b/;
  if (folded.split(/[.!?;]|\b(?:but|however|ale|jednak|natomiast)\b/).some((clause) => (unsupported.test(clause) || externalAccess.test(clause)) && !denial.test(clause)))
    return "Do not claim ordering, checkout or order tracking. Use only the listed capabilities.";
}

/** Safe fallback only after a model has selected the capabilities tool. */
export function capabilityFallback(language: "pl" | "en", topic?: CapabilityTopic): string {
  if (topic === "unprovidedBudget") return language === "pl"
    ? "W tej rozmowie nie mam jeszcze informacji o Twoim budżecie. Do jakiej kwoty mam szukać?"
    : "You haven’t given me a budget in this conversation yet. How much would you like to spend?";
  if (topic === "identity") return language === "pl"
    ? "Wiem o Tobie tyle, ile mi powiesz w tej rozmowie. Nie mam dostępu do Twojego profilu."
    : "I know what you share with me in this conversation. I cannot see a customer profile.";
  if (topic === "catalogAccess") return language === "pl"
    ? "Widzę katalog produktów Aurelle. Cenę i dostępność odczytuję z tych samych danych, które widzisz na karcie produktu."
    : "I can see Aurelle’s catalog. I read prices and stock from the same records you see on the product pages.";
  if (topic === "technology") return language === "pl"
    ? "Wyszukuję produkty w indeksie LanceDB. Cenę i dostępność sprawdzam w katalogu Aurelle, z którego korzysta też karta produktu."
    : "I search Aurelle’s catalog index in LanceDB. Prices and availability come from the same catalog record as the product page.";
  if (topic === "sessions") return language === "pl"
    ? "Widzę wiadomości z tej rozmowy i koszyk w tej przeglądarce. Nie mam dostępu do wcześniejszych sesji ani do zamówień."
    : "I can see the messages in this conversation and the cart in this browser. I cannot access past sessions or orders.";
  if (topic === "accounts" || topic === "external")
    return language === "pl"
      ? "Mam dostęp do katalogu Aurelle i koszyka w tej przeglądarce. Nie widzę Twoich kont, zamówień ani produktów z innych sklepów."
      : "I can check Aurelle’s catalog and the cart in this browser. I cannot access your accounts, orders or other stores’ products.";
  if (topic === "orders")
    return language === "pl"
      ? "Mogę pomóc wybrać produkt i dodać go do koszyka w tej przeglądarce. To sklep demonstracyjny, więc nie przyjmuje płatności ani zamówień do śledzenia."
      : "I can help choose an item and add it to this browser’s cart. This demo cannot accept payments or create an order to track.";
  if (topic === "sources")
    return language === "pl"
      ? "Jestem asystentem zakupowym Aurelle. Korzystam z katalogu tego sklepu i mogę pomóc Ci znaleźć lub porównać produkty."
      : "I’m Aurelle’s shopping assistant. I use this store’s catalog to help you find and compare products.";
  return language === "pl"
    ? "Mogę pomóc znaleźć i porównać produkty oraz sprawdzić zasady dostawy i zwrotów."
    : "I can help you find and compare products and check delivery and returns policies.";
}
