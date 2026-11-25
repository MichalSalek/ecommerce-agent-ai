import { canonicalMaterialKey, MATERIAL_FACTS } from "@/domain/catalog/material-facts";
import { products } from "@/data/products";

const materialsPL: Record<string, string> = {
  "glazed ceramic": "ceramika szkliwiona", glass: "szkło", "walnut wood": "drewno orzechowe",
  stoneware: "kamionka", "stainless steel": "stal nierdzewna", "brass-finish metal": "metal z mosiężnym wykończeniem",
  paper: "papier", metal: "metal", linen: "len", "cushion filling": "wypełnienie poduszki", wool: "wełna",
  wax: "wosk", cloth: "tkanina", brass: "mosiądz", "woven natural fibre": "plecione włókno naturalne",
  terracotta: "terakota", steel: "stal", cotton: "bawełna", "solid oak": "lite drewno dębowe",
  "boucle fabric": "tkanina bouclé", "oak wood": "drewno dębowe", wood: "drewno", reeds: "patyczki",
  "amber glass": "bursztynowe szkło", stone: "kamień", plastic: "tworzywo sztuczne",
  "cushioned fabric": "tkanina z wypełnieniem", fabric: "tkanina", aluminium: "aluminium", felt: "filc",
  "cotton canvas": "płótno bawełniane", ceramic: "ceramika", bamboo: "bambus", cork: "korek",
  wire: "drut", rubber: "guma", "powder-coated steel": "stal malowana proszkowo",
  polyester: "poliester", foam: "pianka", latex: "lateks", filling: "wypełnienie",
};
export function materialLabel(material: string, language: "pl" | "en"): string | undefined {
  if (language === "en") return material;
  const parts = material.split(" and ").map((part) => materialsPL[part]);
  return parts.every(Boolean) ? parts.join(" i ") : undefined;
}

const materialTerms: Record<string, string[]> = {
  ceramic: ["ceramik", "ceramicz"], glass: ["szkło", "szkła", "szkle", "szklan"],
  wood: ["wooden", "drewn"], metal: ["metalow"], steel: ["stal", "stalow", "stali"],
  aluminium: ["aluminum", "aluminiow"], brass: ["mosiądz", "mosięż"],
  cotton: ["bawełn"], linen: ["lnian", "lnu"], fabric: ["tkanin"],
  plastic: ["plastik", "tworzyw"], paper: ["papier"],
};

const knownMaterials = new Set([...Object.keys(MATERIAL_FACTS), ...products.map(p => p.material.toLowerCase())]);

/** Only catalog labels and reviewed material families may become search requirements. */
export function catalogMaterial(value: string): { key: string; terms: string[] } | undefined {
  const key = canonicalMaterialKey(value);
  if (!knownMaterials.has(key)) return;
  return { key, terms: [key, materialLabel(key, "pl") ?? key, ...(materialTerms[key] ?? [])] };
}
