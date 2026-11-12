const formatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
});
export function formatPrice(amount: number) {
  return formatter.format(amount);
}
