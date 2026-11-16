/** Explicit catalog material labels that support each base-material requirement. */
export const MATERIAL_FACTS: Readonly<Record<string, readonly string[]>> = {
  wood: [
    "walnut wood",
    "solid oak",
    "oak wood",
    "wood",
    "boucle fabric and wood",
    "steel and wood",
    "wood and metal",
    "wood and steel",
    "wood and fabric",
  ],
  ceramic: [
    "ceramic",
    "glazed ceramic",
    "ceramic and fabric",
    "ceramic and metal",
    "steel and ceramic",
    "stoneware",
    "terracotta",
  ],
  glass: [
    "glass",
    "amber glass",
    "glass and bamboo",
    "glass and metal",
    "glass and reeds",
    "metal and glass",
    "wax and glass",
  ],
  metal: [
    "metal",
    "aluminium",
    "aluminium and plastic",
    "brass",
    "brass-finish metal",
    "ceramic and metal",
    "fabric and metal",
    "glass and metal",
    "metal and fabric",
    "metal and glass",
    "metal and plastic",
    "metal and polyester",
    "paper and metal",
    "plastic and metal",
    "powder-coated steel",
    "stainless steel",
    "steel",
    "steel and ceramic",
    "steel and plastic",
    "steel and wood",
    "wood and metal",
    "wood and steel",
  ],
  steel: [
    "steel",
    "stainless steel",
    "powder-coated steel",
    "steel and ceramic",
    "steel and plastic",
    "steel and wood",
    "wood and steel",
  ],
  aluminium: ["aluminium", "aluminium and plastic"],
  brass: ["brass"],
  cotton: ["cotton", "cotton and filling", "cotton canvas"],
  linen: ["linen and cushion filling"],
  fabric: [
    "boucle fabric and wood",
    "ceramic and fabric",
    "cloth and paper",
    "cotton canvas",
    "fabric and metal",
    "fabric and plastic",
    "linen and cushion filling",
    "metal and fabric",
    "plastic and cushioned fabric",
    "wood and fabric",
  ],
  plastic: [
    "plastic",
    "aluminium and plastic",
    "fabric and plastic",
    "metal and plastic",
    "plastic and cushioned fabric",
    "plastic and metal",
    "plastic and wire",
    "steel and plastic",
  ],
  paper: ["cloth and paper", "paper and metal"],
};

const normalize = (value: string) => value.trim().toLowerCase();
const aliases: Readonly<Record<string, string>> = {
  wooden: "wood",
  aluminum: "aluminium",
};

/** Match a recorded material or a reviewed base class, never an inferred substring. */
export function matchesMaterial(
  material: string,
  requirement: string,
): boolean {
  const label = normalize(material);
  const requested = normalize(requirement);
  if (!label || !requested) return false;
  if (label === requested) return true;
  const base = Object.hasOwn(aliases, requested)
    ? aliases[requested]
    : requested;
  return (
    Object.hasOwn(MATERIAL_FACTS, base) && MATERIAL_FACTS[base].includes(label)
  );
}
