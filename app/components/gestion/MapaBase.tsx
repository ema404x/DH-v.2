'use client';

// Mapa (Leaflet + OpenStreetMap). Se carga solo en el navegador: la página lo importa con next/dynamic.
// Se maneja Leaflet directamente (sin react-leaflet): React, en desarrollo, monta dos veces y react-leaflet 4
// intenta crear dos mapas sobre el mismo elemento. Así el mapa se crea y se destruye en un solo lugar.
// Los colores salen de los tokens del tema (globals.css), nunca escritos acá.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type Token = 'primario' | 'exito' | 'alerta' | 'peligro' | 'info' | 'suave'
  | 'serie-1' | 'serie-2' | 'serie-3' | 'serie-4' | 'serie-5' | 'serie-6' | 'serie-7' | 'serie-8';

export const SERIES: Token[] = ['serie-1', 'serie-2', 'serie-3', 'serie-4', 'serie-5', 'serie-6', 'serie-7', 'serie-8'];

// Color de un token como lo entiende Leaflet en sus trazos SVG (ahí no valen las variables CSS): "hsl(213 90% 55%)".
export function color(t: Token): string {
  if (typeof window === 'undefined') return 'gray';
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${t}`).trim();
  return v ? `hsl(${v})` : 'gray';
}

export interface MarcaMapa {
  id: string;
  lat: number;
  lng: number;
  // lugar: pin grande con punto de estado · punto: marca chica (fichajes, órdenes hechas)
  forma: 'lugar' | 'punto';
  relleno: Token;
  // punto de estado del pin (semáforo)
  estado?: Token;
  // número dentro del pin (órdenes abiertas en ese lugar)
  numero?: number;
  titulo: string;
  lineas?: string[];
  arrastrable?: boolean;
}

interface Props {
  marcas: MarcaMapa[];
  seleccion?: string | null;
  onElegir?: (id: string) => void;
  onMover?: (id: string, lat: number, lng: number) => void;
  // Con esto activo, tocar el mapa devuelve el punto (para ubicar un lugar a mano). Cambia el cursor.
  onTocar?: (lat: number, lng: number) => void;
  alto?: string;
}

const CENTRO_CABA: L.LatLngTuple = [-34.6037, -58.3816];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function icono(m: MarcaMapa, elegida: boolean): L.DivIcon {
  const tam = elegida ? 40 : 32;
  // El pin es HTML dentro de la página: puede usar las variables del tema tal cual.
  const borde = 'hsl(var(--fondo))';
  const punto = m.estado
    ? `<span style="position:absolute;top:-3px;right:-3px;width:13px;height:13px;border-radius:50%;background:hsl(var(--${m.estado}));border:2px solid ${borde}"></span>`
    : '';
  const dentro = m.numero !== undefined ? `<span style="font:600 12px Inter,sans-serif;color:${borde}">${m.numero}</span>` : '';
  return L.divIcon({
    className: '',
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam],
    popupAnchor: [0, -tam],
    html: `<div style="position:relative;width:${tam}px;height:${tam}px">
      <div style="width:${tam}px;height:${tam}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:hsl(var(--${m.relleno}));border:3px solid ${borde};box-shadow:0 2px 8px hsl(var(--fondo) / .7);display:flex;align-items:center;justify-content:center">
        <div style="transform:rotate(45deg)">${dentro}</div>
      </div>${punto}</div>`,
  });
}

export default function MapaBase({ marcas, seleccion, onElegir, onMover, onTocar, alto = '32rem' }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const encuadrado = useRef(false);
  // Siempre la última versión de los manejadores, sin volver a crear las marcas por eso.
  const manejadores = useRef({ onElegir, onMover, onTocar });
  manejadores.current = { onElegir, onMover, onTocar };

  // Crear y destruir el mapa.
  useEffect(() => {
    if (!contenedor.current) return;
    const m = L.map(contenedor.current, { center: CENTRO_CABA, zoom: 12 });
    // Mapa de OpenStreetMap (sin clave). Se oscurece con un filtro para que acompañe el tema (globals.css).
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      className: 'mapa-oscuro',
    }).addTo(m);
    capa.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => manejadores.current.onTocar?.(e.latlng.lat, e.latlng.lng));
    mapa.current = m;
    encuadrado.current = false;
    return () => {
      m.remove();
      mapa.current = null;
      capa.current = null;
    };
  }, []);

  // Cursor en cruz mientras se está ubicando un lugar.
  useEffect(() => {
    if (contenedor.current) contenedor.current.style.cursor = onTocar ? 'crosshair' : '';
  }, [onTocar]);

  // Dibujar las marcas.
  useEffect(() => {
    const m = mapa.current;
    const g = capa.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const x of marcas) {
      if (x.forma === 'lugar') {
        const pin = L.marker([x.lat, x.lng], { icon: icono(x, x.id === seleccion), draggable: !!x.arrastrable });
        pin.bindTooltip(esc(x.titulo), { direction: 'top', offset: [0, -30] });
        pin.on('click', () => manejadores.current.onElegir?.(x.id));
        pin.on('dragend', () => {
          const p = pin.getLatLng();
          manejadores.current.onMover?.(x.id, p.lat, p.lng);
        });
        pin.addTo(g);
      } else {
        const punto = L.circleMarker([x.lat, x.lng], {
          radius: x.id === seleccion ? 9 : 7, color: color('suave'), weight: 1, fillColor: color(x.relleno), fillOpacity: 0.9,
        });
        punto.bindPopup(`<strong>${esc(x.titulo)}</strong>${(x.lineas ?? []).map((l) => `<div>${esc(l)}</div>`).join('')}`);
        punto.on('click', () => manejadores.current.onElegir?.(x.id));
        punto.addTo(g);
      }
    }
    // Encuadra todas las marcas la primera vez que hay datos.
    if (!encuadrado.current && marcas.length > 0) {
      encuadrado.current = true;
      if (marcas.length === 1) m.setView([marcas[0].lat, marcas[0].lng], 15);
      else m.fitBounds(L.latLngBounds(marcas.map((x) => [x.lat, x.lng] as L.LatLngTuple)), { padding: [30, 30], maxZoom: 15 });
    }
  }, [marcas, seleccion]);

  // Volar a la marca elegida.
  useEffect(() => {
    const m = mapa.current;
    const x = marcas.find((y) => y.id === seleccion);
    if (m && x) m.flyTo([x.lat, x.lng], Math.max(m.getZoom(), 15), { duration: 0.6 });
    // solo al cambiar la selección
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion]);

  return <div ref={contenedor} className="overflow-hidden rounded-lg border" style={{ height: alto, background: 'hsl(var(--superficie))' }} />;
}
