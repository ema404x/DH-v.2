// deno test migracion/emparejar.test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { codigoSAP, emparejar, normNombre } from './emparejar.ts';

const S = 'sector-escuela';
const lugar = (id: string, nombre: string, zona: string, id_origen: string | null = null) => ({ id, sector_id: S, nombre, zona, id_origen });
const escuela = (id_origen: string, nombre: string, zona: string) => ({ id_origen, sector_id: S, nombre, zona });

Deno.test('normaliza nombres como vienen en la v1', () => {
  assertEquals(normNombre('CFP N° 04 ([A])'), normNombre('cfp nº 04'));
  assertEquals(normNombre('JII N°06/21°'), normNombre('JII N° 06/21°'));
  assertEquals(normNombre('EPC  N° 15 República'), normNombre('epc n° 15 republica'));
});

Deno.test('empareja por nombre y comuna cuando el par es único', () => {
  const { pares, ambiguos } = emparejar(
    [escuela('v1a', 'CENS N° 14', '8A'), escuela('v1b', 'JIC N° 02/13°', '8A')],
    [lugar('L1', 'CENS N° 14', '8A'), lugar('L2', 'JIC N° 02/13°', '8A')],
  );
  assertEquals([...pares], [['v1a', 'L1'], ['v1b', 'L2']]);
  assertEquals(ambiguos, []);
});

Deno.test('no empareja entre comunas distintas', () => {
  const { pares } = emparejar([escuela('v1a', 'CENS N° 14', '8B')], [lugar('L1', 'CENS N° 14', '8A')]);
  assertEquals(pares.size, 0);
});

Deno.test('homónimos en la misma comuna: no se adivina, se reporta', () => {
  const { pares, ambiguos } = emparejar(
    [escuela('v1a', 'CENS N° 77', '8A')],
    [lugar('L1', 'CENS N° 77', '8A'), lugar('L2', 'CENS N° 77', '8A')],
  );
  assertEquals(pares.size, 0);
  assertEquals(ambiguos, ['CENS N° 77']);
});

Deno.test('un lugar que ya vino de la migración no se vuelve a usar', () => {
  const { pares } = emparejar([escuela('v1a', 'CENS N° 14', '8A')], [lugar('L1', 'CENS N° 14', '8A', 'otro-origen')]);
  assertEquals(pares.size, 0);
});

Deno.test('solo los códigos SAP cuentan como ubicación técnica', () => {
  assertEquals(codigoSAP('C-IE-0000575-0381'), 'C-IE-0000575-0381');
  assertEquals(codigoSAP(' c-ie-0000575 '), 'C-IE-0000575');
  assertEquals(codigoSAP('CENS N° 14'), null);
  assertEquals(codigoSAP(null), null);
});
