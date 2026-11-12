import { getShop } from "../src/composition/shop";
await getShop().repository.prepare();
console.log("[VECTOR] catalog ready");
