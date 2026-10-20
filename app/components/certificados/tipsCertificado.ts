// Tips de control de calidad por tipo de certificado (tipsCertificado.js de la v1, versión del 8/10/2026 con
// "Limpieza de Campanas"). Se muestran como checklist antes de firmar en la cadena de firmas.
// Para agregar tips de otros tipos (abono_mensual, obra), sumar claves acá.

export const TIPS_POR_TIPO: Record<string, { categoria: string; tips: string[] }[]> = {
  informe: [
    { categoria: 'Termografía', tips: ['¿Está homologado el instrumento utilizado?', '¿Presenta el certificado de calibración?'] },
    { categoria: 'Mediciones de Interruptores', tips: ['¿Está homologado el instrumento utilizado?', '¿Presenta el certificado de calibración?'] },
    {
      categoria: 'Medición de Puesta a Tierra',
      tips: ['¿Está homologado el instrumento utilizado?', '¿Presenta el certificado de calibración?', '¿El valor de medición es diferente al del año anterior?'],
    },
    { categoria: 'Informe Eléctrico Unifilar', tips: ['¿Están todos los tableros de la escuela?'] },
    { categoria: 'Informe de las Instalaciones de Gas', tips: ['¿El valor de medición es diferente al del año anterior?'] },
    {
      categoria: 'Informe de Mampostería',
      tips: [
        '¿Se hicieron trabajos correctivos al momento de la ejecución de este informe no declarados ni mencionados en este informe?',
        '¿Existen trabajos de mejoras iniciados recientemente no declarados en este informe?',
        '¿Se incluyen fotos del avance inicial o del trabajo correctivo terminado?',
      ],
    },
    {
      categoria: 'Informe de Cielorrasos',
      tips: [
        '¿Se hicieron trabajos correctivos al momento de la ejecución de este informe no declarados ni mencionados en este informe?',
        '¿Existen trabajos de mejoras iniciados recientemente no declarados en este informe?',
        '¿Se incluyen fotos del avance inicial o del trabajo correctivo terminado?',
      ],
    },
    {
      categoria: 'Informe de Estructuras',
      tips: [
        '¿Se hicieron trabajos correctivos al momento de la ejecución de este informe no declarados ni mencionados en este informe?',
        '¿Existen trabajos de mejoras iniciados recientemente no declarados en este informe?',
        '¿Se incluyen fotos del avance inicial o del trabajo correctivo terminado?',
      ],
    },
    {
      categoria: 'Informe de Fachadas',
      tips: [
        '¿Se hicieron trabajos correctivos al momento de la ejecución de este informe no declarados ni mencionados en este informe?',
        '¿Existen trabajos de mejoras iniciados recientemente no declarados en este informe?',
        '¿Se incluyen fotos del avance inicial o del trabajo correctivo terminado?',
      ],
    },
    { categoria: 'Limpieza de Campanas', tips: ['¿Tiene remito?', '¿Tiene oblea QR?'] },
  ],
};

export const getTips = (tipoCertificado: string) => TIPS_POR_TIPO[tipoCertificado] || [];
