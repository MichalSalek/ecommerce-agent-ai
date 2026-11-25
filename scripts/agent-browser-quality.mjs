export const text = value => typeof value === 'string' ? value : '';
export const normalize = value => text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ł', 'l');
const customerClauses = value => normalize(value).split(/[.!?;\n]|\b(?:ale|jednak|natomiast|zas|za to)\b/).map(clause => clause.trim()).filter(Boolean);
const customerDenial = /\b(?:nie|brak|bez|niemozliw\w*)\b/;
const customerJargon = /\b(?:system prompt|prompt|prompty|llm|rag|embedding\w*|wektor\w*|model jezykow\w*|wywolan\w* narzedz\w*|narzedzi(?:a|em) (?:modelu|systemu)|api|json|tool.call|evidence.id|endpoint|pipeline|token\w*|schemat (?:narzedzia|modelu))\b/;
export function customerWritingChecks(answer) {
  const value = normalize(answer);
  return [
    { label: 'Customer-facing answer avoids implementation jargon', pass: !customerJargon.test(value) },
    { label: 'Customer-facing answer has a complete ending and correct speaker perspective', pass: /[.!?][”"’)]?$/.test(text(answer).trim()) && !/\bmozesz mi pomoc\b/.test(value) },
  ];
}
export function customerSourceChecks(answer) {
  const value = normalize(answer);
  const noHumanClaim = !/\bjestem (?:pracownikiem|pracownica|czlowiekiem|konsultantem|konsultantka)\b/.test(value);
  const outsideSource = customerClauses(answer).some(clause => !customerDenial.test(clause) && /\b(?:internet\w*|google|inn\w* sklep\w*|zewnetrzn\w* sklep\w*|opinie klient\w*|opinii klient\w*|opini\w* innych klient\w*|producent\w*|dostawc\w*)\b/.test(clause) && /\b(?:korzyst\w*|czerp\w*|biore|pobier\w*|czytam|przeglad\w*|mam dostep|sprawdz\w*)\b/.test(clause));
  const falseCheckout = customerClauses(answer).some(clause => !customerDenial.test(clause) && /\b(?:moge|pomoge|przyjmuje|zloze|zaplace)\b/.test(clause) && /\b(?:zlozyc zamowienie|zlozyc zamowienia|zaplacic|sledzic zamowienie|przyjac platnosc)\b/.test(clause));
  const falseAccount = customerClauses(answer).some(clause => !customerDenial.test(clause) && /\b(?:widze|mam dostep|sprawdze|moge sprawdzic)\b/.test(clause) && /\b(?:kont\w*|zamowien\w*|zamowieni\w*)\b/.test(clause));
  return [
    { label: 'Assistant identifies its role in this shop', pass: noHumanClaim && /\b(?:asystent\w*|wirtualn\w*|bot|automatyczn\w*)\b/.test(value) && /\b(?:sklep\w*|katalog\w*|asortyment\w*)\b/.test(value) },
    { label: 'Answer identifies the shop catalog or product descriptions as its source', pass: /\b(?:katalog\w*|asortyment\w*|opis\w*.{0,50}produkt\w*|informac\w* o produkt\w*)\b/.test(value) && /\b(?:korzyst\w*|czerp\w*|opier\w*|pochodz\w*|bazuj\w*|znajd\w*|szuk\w*|sprawdz\w*|podan\w*|mam|moge|pomog\w*)\b/.test(value) },
    { label: 'Answer explains a real shopping capability', pass: /\b(?:szuk\w*|znajd\w*|znalezc|dobr\w*|dobier\w*|dopas\w*|porown\w*|sprawdz\w*|wyszuk\w*|wybier\w*|wybrac|doradz\w*)\b/.test(value) && /\b(?:produkt\w*|katalog\w*|asortyment\w*|zakup\w*)\b/.test(value) },
    { label: 'Source and capabilities do not invent web access or checkout', pass: !outsideSource && !falseCheckout && !falseAccount },
  ];
}
export function customerExternalChecks(answer) {
  const clauses = customerClauses(answer);
  const otherStore = /\b(?:inn\w* (?:sklep\w*|stron\w*|witryn\w*)|zewnetrzn\w* (?:sklep\w*|stron\w*|witryn\w*)|innych sprzedawc\w*|internet\w*)\b/;
  const access = /\b(?:dostep\w*|przeglad\w*|sprawdz\w*|wyszuk\w*|szuk\w*|znajd\w*|przen\w*|dodaw\w*|dodac|podlaczon\w*)\b/;
  const denied = clauses.some(clause => otherStore.test(clause) && customerDenial.test(clause) && access.test(clause));
  const claimed = clauses.some(clause => (otherStore.test(clause) || /\bwszystk\w* sklep\w*\b/.test(clause)) && !customerDenial.test(clause) && /\b(?:moge|potrafie|sprawdze|wyszukam|znajde|przeniose|dodam|przegladam|mam dostep)\b/.test(clause));
  return [{ label: 'Another store is explicitly outside the assistant’s access', pass: denied && !claimed }];
}
export function customerAccountChecks(answer) {
  const clauses = customerClauses(answer);
  const access = /\b(?:dostep\w*|widze|sprawdz\w*|wglad\w*|informac\w*|mam|moge)\b/;
  const account = /\bkont\w*\b/;
  const orders = /\b(?:zamowien\w*|zamowieni\w*)\b/;
  const denied = topic => clauses.some(clause => customerDenial.test(clause) && topic.test(clause) && access.test(clause));
  const claimed = clauses.some(clause => !customerDenial.test(clause) && /\b(?:widze|mam dostep|sprawdze|moge sprawdzic)\b/.test(clause) && (account.test(clause) || orders.test(clause)));
  return [
    { label: 'Private accounts are explicitly outside the assistant’s access', pass: denied(account) && !claimed },
    { label: 'Other-store orders are explicitly outside the assistant’s access', pass: denied(orders) && !claimed },
  ];
}
export function customerCheckoutChecks(answer) {
  const clauses = customerClauses(answer);
  const cannotPay = clauses.some(clause => customerDenial.test(clause) && /\b(?:plac\w*|zaplac\w*|oplat\w*|platnos\w*)\b/.test(clause));
  const cannotTrack = clauses.some(clause => customerDenial.test(clause) && /\b(?:sledz\w*|status\w*|przesyl\w*|gdzie|stan (?:zamowien\w*|przesyl\w*))\b/.test(clause) && /\b(?:sledz\w*|sprawdz\w*|status\w*|wglad\w*|przyjm\w*|sklad\w*|mozna|moge|ma|jest)\b/.test(clause));
  const fabricated = clauses.some(clause => !customerDenial.test(clause) && /\b(?:mozesz|mozna|moge|przyjmujemy|przyjmuje|sprawdze|sledze|sledzic|mozliw\w*|dostepn\w*)\b/.test(clause) && /\b(?:zaplac\w*|plac\w*|platnos\w*|zamowien\w*|zamowieni\w*|status\w*|przesyl\w*|sledz\w*)\b/.test(clause));
  return [{ label: 'Real checkout and subsequent order tracking are both addressed as unavailable', pass: cannotPay && cannotTrack && !fabricated }];
}
export function customerChoiceChecks(answer) {
  const value = normalize(answer);
  const sentences = customerClauses(answer);
  const mugs = /(?:ceramic mugs|kubk\w*)/;
  const hasChoice = sentences.some(clause => mugs.test(clause) && /\b(?:polec\w*|wybra\w*|wybier\w*|wybor\w*|dobr\w*|lepsz\w*|lepiej|bardziej|pasuj\w*|odpowiedni\w*)\b/.test(clause) && !/\b(?:nie|bez)\b.{0,20}\b(?:polec|wybra|lepsz|pasuj)/.test(clause));
  const hasReason = sentences.some(clause => mugs.test(clause) && /\buchwyt\w*\b/.test(clause) && !/\b(?:nie ma|bez)\s+uchwyt/.test(clause)) && /\b(?:gorac\w*|ciepl\w*)\b/.test(value);
  const inventedCarafe = sentences.some(clause => /(?:glass carafe|karafk\w*)/.test(clause) && /(?:bez uchwyt\w*|brak uchwyt\w*|nie (?:ma|posiada) uchwyt\w*|pojedyncz\w* sztuk\w*|(?:nie )?(?:nadaj\w*|jest (?:przystosowan\w*|odpowiedni\w*|przeznaczon\w*|odporn\w*)|nieodpowiedni\w*|wytrzym\w*|bezpieczn\w*).{0,45}(?:gorac\w*|wysok\w* temperatur\w*|wrzat\w*)|pek\w*.{0,35}gorac\w*)/.test(clause) && !/\b(?:nie wiadomo|nie wiem|nie (?:moge|potrafie) potwierdzic|nie podano|brak informacji)\b/.test(clause));
  return [
    { label: 'Advice directly chooses the mugs for the stated use', pass: hasChoice },
    { label: 'Advice gives the recorded handle and hot-drink reason', pass: hasReason },
    { label: 'Advice does not invent missing handle or heat limitations for the carafe', pass: !inventedCarafe },
  ];
}
