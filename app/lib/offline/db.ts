// Almacenamiento en el teléfono (IndexedDB). Guarda lo que el operario necesita para trabajar sin señal:
//   ots         última versión conocida de cada orden
//   fotos       lista de fotos ya enviadas de cada orden
//   cola        operaciones hechas y todavía no enviadas (incluye las fotos comprimidas)
//   borradores  lo que se está escribiendo en una orden en curso (checklist, notas), por si se cierra la app

const NOMBRE = 'dh1';
const VERSION = 1;

export type Tienda = 'ots' | 'fotos' | 'cola' | 'borradores';

let abierta: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (abierta) return abierta;
  abierta = new Promise<IDBDatabase>((resolver, rechazar) => {
    if (typeof indexedDB === 'undefined') {
      rechazar(new Error('Este navegador no permite guardar datos en el teléfono.'));
      return;
    }
    const pedido = indexedDB.open(NOMBRE, VERSION);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('ots')) db.createObjectStore('ots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'ot_id' });
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('borradores')) db.createObjectStore('borradores', { keyPath: 'ot_id' });
    };
    pedido.onsuccess = () => {
      // Otra pestaña con una versión nueva: se suelta la conexión para no trabarla.
      pedido.result.onversionchange = () => {
        pedido.result.close();
        abierta = null;
      };
      resolver(pedido.result);
    };
    pedido.onerror = () => rechazar(pedido.error ?? new Error('No se pudo abrir el almacenamiento del teléfono.'));
  });
  abierta.catch(() => {
    abierta = null;
  });
  return abierta;
}

async function operar<T>(tienda: Tienda, modo: IDBTransactionMode, accion: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await abrir();
  return new Promise<T>((resolver, rechazar) => {
    const tx = db.transaction(tienda, modo);
    const pedido = accion(tx.objectStore(tienda));
    let resultado: T;
    if (pedido) pedido.onsuccess = () => (resultado = pedido.result);
    // Se resuelve recién cuando la transacción quedó escrita en disco.
    tx.oncomplete = () => resolver(resultado);
    tx.onerror = () => rechazar(tx.error ?? new Error('No se pudo guardar en el teléfono.'));
    tx.onabort = () => rechazar(tx.error ?? new Error('No se pudo guardar en el teléfono. Puede que no quede espacio.'));
  });
}

export const leer = <T>(tienda: Tienda, clave: IDBValidKey) => operar<T | undefined>(tienda, 'readonly', (s) => s.get(clave));
export const leerTodo = <T>(tienda: Tienda) => operar<T[]>(tienda, 'readonly', (s) => s.getAll());
export const poner = <T>(tienda: Tienda, valor: T) => operar<IDBValidKey>(tienda, 'readwrite', (s) => s.put(valor));
export const quitar = (tienda: Tienda, clave: IDBValidKey) => operar<undefined>(tienda, 'readwrite', (s) => s.delete(clave));
export const vaciar = (tienda: Tienda) => operar<undefined>(tienda, 'readwrite', (s) => s.clear());

export function ponerVarios<T>(tienda: Tienda, valores: T[]): Promise<void> {
  if (valores.length === 0) return Promise.resolve();
  return operar<void>(tienda, 'readwrite', (s) => {
    for (const v of valores) s.put(v);
  });
}

export function quitarVarios(tienda: Tienda, claves: IDBValidKey[]): Promise<void> {
  if (claves.length === 0) return Promise.resolve();
  return operar<void>(tienda, 'readwrite', (s) => {
    for (const c of claves) s.delete(c);
  });
}

// Le pide al navegador que no borre estos datos si el teléfono se queda sin espacio.
export async function pedirPersistencia(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Si el navegador no lo soporta, se sigue igual.
  }
}
