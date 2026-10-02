// Compresión de fotos en el teléfono, antes de subirlas.
// Una foto de cámara pesa 5 a 10 MB; subirlas así es lo que tiraba "memoria insuficiente" en la v1.
// Acá se achican a 1600 px de lado mayor y JPEG 0.8 (200 a 400 KB), de a una, y se libera todo.

const LADO_MAXIMO = 1600;
const CALIDAD = 0.8;

export async function comprimirImagen(archivo: File): Promise<Blob> {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen.');
  }

  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    // imageOrientation respeta la rotación que guardó la cámara.
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El teléfono no pudo procesar la foto.');
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const lienzo = canvas;
    const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, 'image/jpeg', CALIDAD));
    if (!blob) throw new Error('El teléfono no pudo procesar la foto.');
    return blob;
  } finally {
    // Liberar la memoria ya, sin esperar al recolector: es lo que permite sacar varias fotos seguidas.
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
