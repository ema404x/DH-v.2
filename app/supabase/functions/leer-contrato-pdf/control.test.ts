// Pruebas de lo que no depende de la IA: lectura de números, subtotales colados y control de la suma.
//   npx deno test supabase/functions/leer-contrato-pdf/control.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { itemsValidos, numero, validar } from './index.ts';

Deno.test('números en los formatos que trae un PDF', () => {
  assertEquals(numero('1.234.567,89'), 1234567.89);
  assertEquals(numero('1,234,567.89'), 1234567.89);
  assertEquals(numero('$ 12.500,00'), 12500);
  assertEquals(numero('2,5'), 2.5);
  assertEquals(numero('1,000,000'), 1000000);
  assertEquals(numero(350), 350);
  assertEquals(numero('sin dato'), 0);
});

Deno.test('descarta renglones vacíos o sin cantidad', () => {
  const items = itemsValidos([
    { descripcion: 'Pintura de aulas', um: 'm2', cantidad: 100, importe_unitario: 1500 },
    { descripcion: '', um: 'u', cantidad: 1, importe_unitario: 10 },
    { descripcion: 'Sin cantidad', um: 'u', cantidad: 0, importe_unitario: 10 },
  ]);
  assertEquals(items.length, 1);
  assertEquals(items[0].subtotal_sospechoso, false);
});

Deno.test('marca los subtotales que la IA tomó como ítems', () => {
  const items = itemsValidos([
    { descripcion: 'Demolición', um: 'm2', cantidad: 10, importe_unitario: 100 },
    { descripcion: 'Retiro de escombros', um: 'gl', cantidad: 1, importe_unitario: 500 },
    { descripcion: 'Rubro 1', um: 'gl', cantidad: 1, importe_unitario: 1500 }, // = 1000 + 500
    { descripcion: 'Revoque', um: 'm2', cantidad: 20, importe_unitario: 50 },
    { descripcion: 'Subtotal rubro 2', um: 'gl', cantidad: 1, importe_unitario: 999 },
  ]);
  assertEquals(items.map((i) => i.subtotal_sospechoso), [false, false, true, false, true]);
});

Deno.test('control de la suma contra el total del documento', () => {
  const items = itemsValidos([{ descripcion: 'Abono', um: 'mes', cantidad: 12, importe_unitario: 100000 }]);
  assertEquals(validar(items, 1_200_000).coincide, true);
  assertEquals(validar(items, 1_205_000).coincide, true); // dentro del 0,5 %
  assertEquals(validar(items, 1_300_000).coincide, false);
  assertEquals(validar(items, 1_300_000).diferencia, -100000);
  assertEquals(validar(items, 0).coincide, null); // el documento no dice el total
});
