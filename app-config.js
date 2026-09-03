/* =========================================================================
   CONFIGURACIÓN GLOBAL DE LOTE SCOUT
   -------------------------------------------------------------------------
   Estos valores aplican para TODOS los usuarios, en todos los dispositivos.
   (Antes vivían en localStorage y solo funcionaban en el navegador del admin.)

   Ninguno de estos datos es secreto: el link de pago y la URL del Apps Script
   son públicos por diseño.

   Después de editar este archivo: git add -A && git commit && git push
   ========================================================================= */
window.appConfig = {

  // Link de pago de Wompi. Panel de Wompi → Links de pago → copiar la URL.
  payUrl: "https://checkout.wompi.co/l/nqfvek",

  // Backend de Apps Script para enviar informes por correo (termina en /exec).
  // Déjalo vacío y el botón simplemente descarga el informe.
  reportEndpoint: ""

};
