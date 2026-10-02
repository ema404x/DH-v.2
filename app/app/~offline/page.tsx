import { WifiOff } from 'lucide-react';

// Página que muestra el service worker cuando se pide una pantalla que no está guardada y no hay señal.
export default function SinConexion() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="h-12 w-12 text-alerta" aria-hidden />
      <h1>Sin señal</h1>
      <p className="text-suave">
        Esta pantalla no está guardada en el teléfono. Volvé a &quot;Mis órdenes&quot; para ver lo último que se cargó, o probá de nuevo cuando tengas conexión.
      </p>
      <a href="/mis-ots" className="inline-flex min-h-campo items-center rounded border bg-elevado px-4 font-semibold">
        Ir a Mis órdenes
      </a>
    </main>
  );
}
