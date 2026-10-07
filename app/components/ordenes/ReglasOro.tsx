'use client';

import { X, Zap } from 'lucide-react';

// ReglasOroElectricidad de la v1 (versión compacta del alta de OT).
export const REGLAS_ORO = [
  { numero: 1, titulo: 'Corte visible o efectivo', icon: '⚡',
    descripcion: 'Aislá la instalación desconectando todas las fuentes de alimentación. El corte debe ser físico y visible (interruptores abiertos, fusibles retirados).' },
  { numero: 2, titulo: 'Bloqueo y etiquetado', icon: '🔒',
    descripcion: 'Bloqueá mecánicamente los dispositivos de corte (candado) y etiquetálos para evitar reconexiones accidentales mientras trabajás.' },
  { numero: 3, titulo: 'Verificación de ausencia de tensión', icon: '🔍',
    descripcion: 'Nunca confíes solo en que una llave está abierta. Verificá con instrumental que no hay electricidad en los cables.' },
  { numero: 4, titulo: 'Puesta a tierra y en cortocircuito', icon: '🌍',
    descripcion: 'Conectá a tierra todos los conductores activos para evitar diferencias de potencial peligrosas durante el trabajo.' },
  { numero: 5, titulo: 'Señalización y delimitación de la zona', icon: '🚧',
    descripcion: 'Delimitá y señalizá la zona de trabajo para que el personal no autorizado no pueda acceder ni energizar accidentalmente.' },
];

export function ReglasOroElectricidad({ onClose }: { onClose?: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border-2 border-yellow-500/40 bg-yellow-500/8">
      <div className="flex items-center justify-between border-b border-yellow-500/30 bg-yellow-500/15 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/20">
            <Zap className="h-4 w-4 text-yellow-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-yellow-300">⚠️ 5 Reglas de Oro — Seguridad Eléctrica</p>
            <p className="text-[11px] text-yellow-400/70">Obligatorias antes de iniciar cualquier trabajo eléctrico</p>
          </div>
        </div>
        {onClose && (
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-yellow-400/60 transition-colors hover:text-yellow-400">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 px-4 py-3">
        {REGLAS_ORO.map((r) => (
          <div key={r.numero} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-[10px] font-bold text-yellow-400">{r.numero}</span>
            <div>
              <span className="text-xs font-semibold text-yellow-300">{r.icon} {r.titulo}: </span>
              <span className="text-xs text-yellow-200/70">{r.descripcion}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-yellow-500/20 bg-yellow-500/10 px-4 py-2.5">
        <p className="text-center text-[11px] font-medium text-yellow-400/80">El incumplimiento de estas reglas puede causar accidentes graves o fatales.</p>
      </div>
    </div>
  );
}
