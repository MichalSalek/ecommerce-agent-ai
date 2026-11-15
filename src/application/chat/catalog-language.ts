import type { Product } from "@/domain/catalog/product";

// Keys are catalog feature text. Values describe only that feature; the catalog
// remains the source of product facts, and no product-specific rules are used.
const wording: Record<string, readonly [string, string]> = Object.fromEntries(
  [
    [
      "10000 mAh battery",
      "ma akumulator o pojemności 10000 mAh",
      "has a 10000 mAh battery",
    ],
    ["15 W charging", "ładuje z mocą 15 W", "charges at 15 W"],
    [
      "Bluetooth connection",
      "łączy się przez Bluetooth",
      "connects via Bluetooth",
    ],
    ["HDMI", "ma złącze HDMI", "has an HDMI port"],
    ["LED desk light", "jest biurkową lampą LED", "is an LED desk light"],
    ["USB powered", "ma zasilanie przez USB", "is powered via USB"],
    ["USB receiver", "ma odbiornik USB", "has a USB receiver"],
    [
      "USB-C charging pass-through",
      "ma przelotowe ładowanie przez USB-C",
      "has USB-C charging pass-through",
    ],
    ["USB-C connection", "ma złącze USB-C", "has a USB-C connection"],
    [
      "adjustable angle",
      "ma regulowany kąt ustawienia",
      "has an adjustable angle",
    ],
    ["adjustable arm", "ma regulowane ramię", "has an adjustable arm"],
    ["adjustable loop", "ma regulowaną pętlę", "has an adjustable loop"],
    ["botanical fragrance", "ma roślinny zapach", "has a botanical fragrance"],
    ["brewing timer", "ma minutnik do parzenia", "has a brewing timer"],
    [
      "brews into a mug",
      "pozwala parzyć kawę bezpośrednio do kubka",
      "brews coffee into a mug",
    ],
    ["carry handle", "ma uchwyt do przenoszenia", "has a carry handle"],
    ["carry handles", "ma uchwyty do przenoszenia", "has carry handles"],
    ["cedar scent", "ma cedrowy zapach", "has a cedar scent"],
    ["ceramic base", "ma ceramiczną podstawę", "has a ceramic base"],
    ["ceramic body", "ma ceramiczny korpus", "has a ceramic body"],
    ["ceramic burrs", "ma ceramiczne żarna", "has ceramic burrs"],
    [
      "closed storage",
      "zapewnia zamknięte przechowywanie",
      "provides closed storage",
    ],
    [
      "cloth-bound cover",
      "ma okładkę oprawioną w tkaninę",
      "has a cloth-bound cover",
    ],
    [
      "coiled storage",
      "można zwinąć do przechowywania",
      "can be coiled for storage",
    ],
    ["coloured glass", "jest z barwionego szkła", "is made of coloured glass"],
    ["compact ball", "jest niewielką piłką", "is a compact ball"],
    ["compact frame", "ma niewielką ramę", "has a compact frame"],
    ["compact layout", "ma kompaktowy układ", "has a compact layout"],
    [
      "compact round top",
      "ma niewielki okrągły blat",
      "has a compact round top",
    ],
    ["compact size", "ma niewielkie rozmiary", "has a compact size"],
    ["compact stool", "jest niewielkim stołkiem", "is a compact stool"],
    ["cotton fabric", "jest z bawełnianej tkaniny", "is made of cotton fabric"],
    [
      "cutlery set for one",
      "jest zestawem sztućców dla jednej osoby",
      "is a cutlery set for one",
    ],
    ["cylindrical shape", "ma walcowaty kształt", "has a cylindrical shape"],
    ["desktop size", "ma rozmiar odpowiedni na biurko", "is sized for a desk"],
    [
      "desktop support",
      "ma podstawę do ustawienia na biurku",
      "has a desktop support",
    ],
    ["digital display", "ma cyfrowy wyświetlacz", "has a digital display"],
    [
      "directed illumination",
      "daje skierowane światło",
      "provides directed illumination",
    ],
    ["directed light", "daje skierowane światło", "provides directed light"],
    [
      "divided compartments",
      "ma podzielone przegródki",
      "has divided compartments",
    ],
    ["fabric cover", "ma pokrowiec z tkaniny", "has a fabric cover"],
    ["fabric shade", "ma klosz z tkaniny", "has a fabric shade"],
    ["fabric sling", "ma siedzisko z tkaniny", "has a fabric sling"],
    ["filled cushion", "jest wypełnioną poduszką", "is a filled cushion"],
    [
      "fine mesh basket",
      "ma koszyczek z drobnej siatki",
      "has a fine mesh basket",
    ],
    [
      "fits a 13-inch laptop",
      "mieści laptopa o przekątnej 13 cali",
      "fits a 13-inch laptop",
    ],
    [
      "flat cutting surface",
      "ma płaską powierzchnię do krojenia",
      "has a flat cutting surface",
    ],
    ["flat pad", "ma płaską powierzchnię", "has a flat pad"],
    ["flat top", "ma płaski blat", "has a flat top"],
    ["flexible hose", "jest elastycznym wężem", "is a flexible hose"],
    [
      "floor-standing base",
      "ma podstawę do ustawienia na podłodze",
      "has a floor-standing base",
    ],
    ["folding frame", "ma składaną ramę", "has a folding frame"],
    [
      "for indoor herbs",
      "jest przeznaczony do ziół uprawianych w pomieszczeniu",
      "is intended for indoor herbs",
    ],
    [
      "for indoor plants",
      "jest przeznaczony do roślin domowych",
      "is intended for indoor plants",
    ],
    [
      "for light gardening",
      "służy do lekkich prac ogrodowych",
      "is intended for light gardening",
    ],
    [
      "for small stems",
      "nadaje się do małych łodyg",
      "is intended for small stems",
    ],
    ["four hooks", "ma cztery haczyki", "has four hooks"],
    ["glass bottle", "ma szklaną butelkę", "has a glass bottle"],
    ["glass jar", "ma szklany słoik", "has a glass jar"],
    ["glass shade", "ma szklany klosz", "has a glass shade"],
    [
      "handles for hot drinks",
      "ma uchwyty do gorących napojów",
      "has handles for hot drinks",
    ],
    ["hanging hook", "ma haczyk do zawieszenia", "has a hanging hook"],
    ["hanging loop", "ma pętlę do zawieszenia", "has a hanging loop"],
    [
      "holds books upright",
      "utrzymuje książki w pionie",
      "holds books upright",
    ],
    ["holds fresh flowers", "mieści świeże kwiaty", "holds fresh flowers"],
    [
      "holds fresh or dried stems",
      "mieści świeże lub suszone łodygi",
      "holds fresh or dried stems",
    ],
    ["insulated body", "ma izolowany korpus", "has an insulated body"],
    ["lift-up seat", "ma unoszone siedzisko", "has a lift-up seat"],
    ["loop shape", "ma kształt pętli", "has a loop shape"],
    ["low profile", "ma niski profil", "has a low profile"],
    ["manual crank", "ma ręczną korbkę", "has a manual crank"],
    [
      "mechanical wind-up",
      "ma mechanizm do ręcznego nakręcania",
      "is mechanically wound",
    ],
    ["metal body", "ma metalowy korpus", "has a metal body"],
    [
      "metal construction",
      "ma metalową konstrukcję",
      "has a metal construction",
    ],
    ["metal frame", "ma metalową ramę", "has a metal frame"],
    ["narrow neck", "ma wąską szyjkę", "has a narrow neck"],
    ["narrow opening", "ma wąski otwór", "has a narrow opening"],
    ["narrow pouring spout", "ma wąską wylewkę", "has a narrow pouring spout"],
    ["narrow spout", "ma wąską wylewkę", "has a narrow spout"],
    ["no batteries", "działa bez baterii", "works without batteries"],
    [
      "non-slip surface",
      "ma antypoślizgową powierzchnię",
      "has a non-slip surface",
    ],
    ["open compartments", "ma otwarte przegródki", "has open compartments"],
    [
      "open display",
      "ma otwartą powierzchnię ekspozycyjną",
      "has an open display surface",
    ],
    [
      "open feeding tray",
      "ma otwartą tackę na pokarm",
      "has an open feeding tray",
    ],
    [
      "open main compartment",
      "ma otwartą komorę główną",
      "has an open main compartment",
    ],
    [
      "open storage",
      "ma otwartą przestrzeń do przechowywania",
      "has open storage",
    ],
    ["open top", "ma otwartą górę", "has an open top"],
    ["open tray", "ma otwartą tackę", "has an open tray"],
    ["open wire shelves", "ma otwarte półki z drutu", "has open wire shelves"],
    ["optical sensor", "ma czujnik optyczny", "has an optical sensor"],
    [
      "outdoor use",
      "nadaje się do użytku na zewnątrz",
      "is intended for outdoor use",
    ],
    ["over-ear cushions", "ma nauszne poduszki", "has over-ear cushions"],
    ["pair of gloves", "jest parą rękawic", "is a pair of gloves"],
    ["pair of supports", "jest parą podpórek", "is a pair of supports"],
    ["paper pages", "ma papierowe strony", "has paper pages"],
    ["paper shade", "ma papierowy klosz", "has a paper shade"],
    ["pointed scoop", "ma zaostrzoną część roboczą", "has a pointed scoop"],
    ["pump top", "ma dozownik z pompką", "has a pump top"],
    ["quiet click", "ma cichy klik", "has a quiet click"],
    ["rechargeable", "można ponownie naładować", "is rechargeable"],
    ["reclining back", "ma regulowane oparcie", "has a reclining back"],
    [
      "rectangular blocks",
      "składa się z prostokątnych klocków",
      "consists of rectangular blocks",
    ],
    ["rectangular shape", "ma prostokątny kształt", "has a rectangular shape"],
    [
      "refillable bottle",
      "ma butelkę do ponownego napełniania",
      "has a refillable bottle",
    ],
    ["removable cushions", "ma zdejmowane poduszki", "has removable cushions"],
    ["removable lid", "ma zdejmowaną pokrywę", "has a removable lid"],
    [
      "replaceable ink refill",
      "ma wymienny wkład atramentowy",
      "has a replaceable ink refill",
    ],
    ["reusable", "nadaje się do ponownego użytku", "is reusable"],
    ["reusable cone", "ma stożek wielokrotnego użytku", "has a reusable cone"],
    [
      "reusable glass box",
      "jest szklanym pojemnikiem wielokrotnego użytku",
      "is a reusable glass box",
    ],
    [
      "rolls for storage",
      "można zwinąć do przechowywania",
      "can be rolled for storage",
    ],
    ["round cushion", "jest okrągłą poduszką", "is a round cushion"],
    [
      "round dinner plates",
      "jest zestawem okrągłych talerzy obiadowych",
      "is a set of round dinner plates",
    ],
    ["round mirror", "jest okrągłym lustrem", "is a round mirror"],
    ["round shape", "ma okrągły kształt", "has a round shape"],
    ["round top", "ma okrągły blat", "has a round top"],
    [
      "sealed bamboo lid",
      "ma szczelną bambusową pokrywę",
      "has a sealed bamboo lid",
    ],
    ["secateur blades", "ma ostrza sekatora", "has secateur blades"],
    [
      "serves cold brew",
      "służy do podawania kawy cold brew",
      "serves cold brew",
    ],
    [
      "serving board",
      "może służyć jako deska do podawania",
      "can serve as a serving board",
    ],
    ["set of four", "jest zestawem czterech sztuk", "comes as a set of four"],
    ["set of pots", "jest zestawem doniczek", "comes as a set of pots"],
    ["set of three", "jest zestawem trzech sztuk", "comes as a set of three"],
    ["set of two", "jest zestawem dwóch sztuk", "comes as a set of two"],
    ["slatted seat", "ma siedzisko z listew", "has a slatted seat"],
    [
      "slatted seat and back",
      "ma siedzisko i oparcie z listew",
      "has a slatted seat and back",
    ],
    ["slatted shelves", "ma półki z listew", "has slatted shelves"],
    [
      "slim standing base",
      "ma smukłą podstawę stojącą",
      "has a slim standing base",
    ],
    ["sofa throw", "jest kocem na sofę", "is a sofa throw"],
    ["soft fabric", "ma miękką tkaninę", "has soft fabric"],
    ["soft sleeve", "jest miękkim etui", "is a soft sleeve"],
    ["solar panel", "ma panel słoneczny", "has a solar panel"],
    ["stackable", "można ustawiać jeden na drugim", "can be stacked"],
    [
      "stemmed glasses",
      "jest zestawem kieliszków na nóżce",
      "is a set of stemmed glasses",
    ],
    ["storage compartment", "ma schowek", "has a storage compartment"],
    [
      "stovetop use",
      "nadaje się do używania na kuchence",
      "is intended for stovetop use",
    ],
    ["string of bulbs", "ma przewód z żarówkami", "has a string of bulbs"],
    [
      "textured surface",
      "ma fakturowaną powierzchnię",
      "has a textured surface",
    ],
    ["three legs", "ma trzy nogi", "has three legs"],
    ["three prongs", "ma trzy zęby", "has three prongs"],
    ["travel lid", "ma pokrywkę podróżną", "has a travel lid"],
    ["two USB ports", "ma dwa porty USB", "has two USB ports"],
    ["two handles", "ma dwa uchwyty", "has two handles"],
    ["two open tiers", "ma dwa otwarte poziomy", "has two open tiers"],
    ["two-person bench", "jest ławką dwuosobową", "is a two-person bench"],
    ["two-seat frame", "ma ramę na dwa miejsca", "has a two-seat frame"],
    [
      "upholstered seat",
      "ma tapicerowane siedzisko",
      "has an upholstered seat",
    ],
    ["upright dividers", "ma pionowe przegródki", "has upright dividers"],
    ["waffle weave", "ma splot waflowy", "has a waffle weave"],
    [
      "wall-mounted fixture",
      "montuje się na ścianie",
      "is a wall-mounted fixture",
    ],
    [
      "wall-mounted rail",
      "ma listwę do montażu na ścianie",
      "has a wall-mounted rail",
    ],
    [
      "wall-mounted shelf",
      "jest półką montowaną na ścianie",
      "is a wall-mounted shelf",
    ],
    ["wooden handle", "ma drewniany uchwyt", "has a wooden handle"],
    ["wooden legs", "ma drewniane nogi", "has wooden legs"],
    ["woven blanket", "jest tkanym kocem", "is a woven blanket"],
    ["woven cotton", "jest z tkanej bawełny", "is made of woven cotton"],
    ["woven strap", "ma tkany pasek", "has a woven strap"],
    ["wrist loop", "ma pętlę na nadgarstek", "has a wrist loop"],
    ["zip closure", "ma zapięcie na zamek", "has a zip closure"],
  ].map(([feature, pl, en]) => [feature, [pl, en] as const]),
);

function dimensionsInPolish(dimensions: string): string {
  return dimensions
    .replaceAll("one adult size", "jeden rozmiar dla dorosłych")
    .replaceAll("loop length", "długości pętli")
    .replaceAll("with reeds", "z patyczkami")
    .replaceAll("1 litre capacity", "pojemność 1 litra")
    .replaceAll(/(\d+) ml capacity/g, "pojemność $1 ml")
    .replaceAll("diameter", "średnicy")
    .replaceAll("high", "wysokości")
    .replaceAll("long", "długości")
    .replaceAll("each", "każda sztuka")
    .replaceAll("folded", "po złożeniu")
    .replaceAll(" and ", " i ");
}

/** A factual verb phrase suitable for placing after the catalog product name. */
export function featureClause(
  product: Product,
  language: "pl" | "en",
  featureIndex = 0,
): string {
  const feature = product.features[featureIndex];
  const entry =
    feature !== undefined && Object.hasOwn(wording, feature)
      ? wording[feature]
      : undefined;
  if (!entry)
    return language === "pl"
      ? `ma podane wymiary: ${dimensionsInPolish(product.dimensions)}`
      : `has the following dimensions: ${product.dimensions}`;
  if (language === "pl") return entry[0];
  // Catalog names ending in a plural noun take a plural English verb.
  const plural = /s$/i.test(product.name) && !/(ss|us|is)$/i.test(product.name);
  return plural
    ? entry[1].replace(
        /^(has|is|comes|fits|holds|serves|brews|connects|charges|provides|works|consists)\b/,
        (verb) =>
          ({
            has: "have",
            is: "are",
            comes: "come",
            fits: "fit",
            holds: "hold",
            serves: "serve",
            brews: "brew",
            connects: "connect",
            charges: "charge",
            provides: "provide",
            works: "work",
            consists: "consist",
          })[verb] ?? verb,
      )
    : entry[1];
}
