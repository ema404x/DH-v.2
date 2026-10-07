import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Igual que src/lib/utils.js de la v1: une clases de Tailwind sin choques.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
