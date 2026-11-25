import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as checks from '../scripts/agent-browser-quality.mjs';
const allPass = (items: { pass: boolean }[]) => items.every(item => item.pass);

test('shop identity checks require catalog source, a nonhuman role and real shopping capability', () => {
  const good = 'Jestem wirtualną asystentką tego sklepu. Korzystam z katalogu produktów i pomogę Ci je porównać.';
  assert.ok(allPass(checks.customerSourceChecks(good)));
  assert.ok(allPass(checks.customerWritingChecks(good)));
  for (const answer of [
    'Jestem pracownikiem sklepu. Korzystam z katalogu produktów i pomogę Ci je porównać.',
    'Jestem wirtualną asystentką sklepu. Pomogę w wielu sprawach.',
    'Jestem wirtualną asystentką. Korzystam z katalogu produktów.',
    'Jestem wirtualną asystentką sklepu, korzystam z katalogu produktów, a dane pobieram z internetu. Pomogę je porównać.',
    'Jestem wirtualną asystentką sklepu, korzystam z katalogu produktów i czytam opinie klientów. Pomogę je porównać.',
    'Jestem wirtualną asystentką sklepu, korzystam z katalogu produktów i mogę złożyć zamówienie.',
    'Jestem wirtualną asystentką sklepu, korzystam z katalogu produktów i widzę Twoje konto.',
  ]) assert.equal(allPass(checks.customerSourceChecks(answer)), false, answer);
  assert.equal(allPass(checks.customerWritingChecks('Narzędzie API zwróciło dane z JSON.')), false);
  assert.equal(allPass(checks.customerWritingChecks('Możesz mi pomóc z produktami.')), false);
  assert.equal(allPass(checks.customerWritingChecks('Mogę pomóc Ci znaleźć produkt')), false);
});

test('another store and accounts require an explicit denial without a conflicting access claim', () => {
  assert.ok(allPass(checks.customerExternalChecks('Nie mam dostępu do innych sklepów. Mogę poszukać podobnego produktu w naszym katalogu.')));
  assert.equal(allPass(checks.customerExternalChecks('Mogę sprawdzić inny sklep i dodać ten produkt.')), false);
  assert.equal(allPass(checks.customerExternalChecks('Nie mam dostępu do innych sklepów, ale mam dostęp do wszystkich sklepów.')), false);
  assert.equal(allPass(checks.customerExternalChecks('Nie mam dostępu do innych sklepów, ale mogę sprawdzić inny sklep.')), false);
  assert.ok(allPass(checks.customerAccountChecks('Nie mam wglądu do Twojego konta ani zamówień z innych sklepów.')));
  assert.equal(allPass(checks.customerAccountChecks('Widzę Twoje zamówienia z innych sklepów.')), false);
  assert.equal(allPass(checks.customerAccountChecks('Nie widzę Twoich zamówień z innych sklepów.')), false);
  assert.ok(allPass(checks.customerAccountChecks('Nie widzę Twojego konta. Nie mogę sprawdzić zamówień z innych sklepów.')));
});

test('checkout and tracking both need a direct truthful boundary', () => {
  assert.ok(allPass(checks.customerCheckoutChecks('Nie przyjmujemy płatności ani zamówień. Nie mogę śledzić ich statusu.')));
  assert.equal(allPass(checks.customerCheckoutChecks('Nie przyjmujemy płatności.')), false);
  assert.equal(allPass(checks.customerCheckoutChecks('Nie przyjmujemy płatności ani zamówień.')), false);
  assert.equal(allPass(checks.customerCheckoutChecks('Nie przyjmujemy zamówień i nie mogę ich śledzić. Płatności są możliwe.')), false);
  assert.equal(allPass(checks.customerCheckoutChecks('Możesz zapłacić i śledzić przesyłkę.')), false);
  assert.equal(allPass(checks.customerCheckoutChecks('Nie przyjmujemy płatności, ale mogę sprawdzić status zamówienia.')), false);
});

test('a recommendation needs a direct choice and a recorded hot-drink handle reason', () => {
  const good = 'Do gorącej kawy polecam Ceramic mugs, bo kubki mają uchwyty do gorących napojów.';
  assert.ok(allPass(checks.customerChoiceChecks(good)));
  assert.ok(allPass(checks.customerWritingChecks(good)));
  for (const answer of [
    'Ceramic mugs mają uchwyty do gorących napojów, a Glass carafe służy do cold brew.',
    'Do gorącej kawy polecam Ceramic mugs, bo są ładne.',
    'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Glass carafe nie ma uchwytu.',
    'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Karafka nie nadaje się do gorącej kawy.',
    'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Glass carafe nadaje się do gorących napojów.',
    'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Karafka nie jest odpowiednia do gorących napojów.',
    'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Glass carafe jest pojedynczą sztuką.',
  ]) assert.equal(allPass(checks.customerChoiceChecks(answer)), false, answer);
  const uncertain = 'Do gorącej kawy polecam Ceramic mugs, bo mają uchwyty. Nie potrafię potwierdzić, czy karafka wytrzyma gorącą kawę.';
  assert.ok(allPass(checks.customerChoiceChecks(uncertain)));
  assert.ok(allPass(checks.customerChoiceChecks('Ceramic mugs to dobry wybór do gorącej kawy, ponieważ mają uchwyty.')));
});


test('a short Polish fact is recognized even when the catalog name is English', () => {
  assert.ok(checks.containsPolish('Tak, Ceramic mugs mają uchwyty.'));
  assert.equal(checks.containsPolish('Glass carafe is in stock.'), false);
});

test('a disclaimer about the assistant cannot conceal a promise of a real later checkout', () => {
  assert.equal(checks.customerCardCheck('Nie pobieram płatności – ale rzeczywiste obciążenie karty nastąpi dopiero przy finalizacji zamówienia.').pass, false);
  assert.equal(checks.customerCardCheck('Nie obciążę Twojej karty. Ten sklep demonstracyjny nie przyjmuje płatności.').pass, true);
});
