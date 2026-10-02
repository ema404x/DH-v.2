// Abre el SQL Editor o el editor de Edge Functions de Supabase con el contenido EXACTO de un archivo del proyecto,
// sin copiar y pegar a mano. El contenido viaja en el fragmento de la dirección (lo que va después de #),
// que no se envía a ningún servidor; en la página se pega en el editor con:
//     monaco.editor.getModels()[0].setValue(decodeURIComponent(location.hash.slice(1)))
//
//   node herramientas/abrir-en-supabase.mjs <ref-del-proyecto>
//   http://127.0.0.1:8788/sql/dh1-v2-fase6-operacion.sql      → SQL Editor con ese archivo
//   http://127.0.0.1:8788/funcion/informe-inspeccion          → editor de funciones con su index.ts
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ref = process.argv[2];
if (!ref) {
  console.error('Falta el ref del proyecto de Supabase.');
  process.exit(1);
}
const raiz = join(import.meta.dirname, '..');
const panel = `https://supabase.com/dashboard/project/${ref}`;

createServer((req, res) => {
  const [, tipo, nombre] = decodeURIComponent((req.url ?? '').split('?')[0]).split('/');
  try {
    if (tipo === 'sql' && /^[\w.-]+\.sql$/.test(nombre ?? '')) {
      const sql = readFileSync(join(raiz, basename(nombre)), 'utf8');
      res.writeHead(302, { Location: `${panel}/sql/new#${encodeURIComponent(sql)}` });
    } else if (tipo === 'funcion' && /^[\w-]+$/.test(nombre ?? '')) {
      const codigo = readFileSync(join(raiz, 'app', 'supabase', 'functions', nombre, 'index.ts'), 'utf8');
      res.writeHead(302, { Location: `${panel}/functions/new#${encodeURIComponent(codigo)}` });
    } else {
      res.writeHead(404);
    }
  } catch {
    res.writeHead(404);
  }
  res.end();
}).listen(8788, '127.0.0.1', () => console.log('listo en http://127.0.0.1:8788'));
