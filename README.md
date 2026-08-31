# Lote Scout · CRM de vallas y lotes (multi-ciudad, con cuentas)

App web para captar propiedades a partir de fotos de **vallas de venta/renta**:

- **Cuentas** (login / registro). Cada usuario ve **solo sus propias fotos**.
- Subes fotos **desde el carrete** → se ubican en el **mapa** (usan el GPS de la foto; si no tiene, quedan en el centro de tu ciudad y las mueves tocando el mapa). Funciona en **cualquier ciudad**.
- **Detección del teléfono con IA (OCR)** desde la foto de la valla → botón para **llamar directo** (`tel:`) o abrir **WhatsApp**.
- Campos tipo **CRM**: ¿por qué vende?, **precio**, operación (venta/renta), dirección y **agendar visita** (con enlace a Google Calendar).
- **Ciudad en Ajustes** (define el centro del mapa). Preparado para que, al extender la app, cada ciudad cargue su **normativa**.

## Modo demo vs cuentas reales

- **Sin configurar Firebase** → corre en **modo demo local**: todo se guarda solo en ese navegador (útil para probar ya). No hay usuarios reales ni sincronización entre dispositivos.
- **Con Firebase configurado** → **cuentas reales en la nube**: login/registro (correo o Google), fotos y datos por usuario, visibles desde cualquier dispositivo.

## Configurar Firebase (una sola vez, ~5 min)

1. Entra a **https://console.firebase.google.com** → **Agregar proyecto** (gratis).
2. Dentro del proyecto, ícono **</> (Web)** → registra una app → copia el objeto **`firebaseConfig`**.
3. Pega esos valores en **`firebase-config.js`** (reemplaza los `PEGA_AQUI`).
4. En la consola de Firebase, activa:
   - **Authentication** → *Sign-in method* → habilita **Correo/Contraseña** y **Google**.
   - **Firestore Database** → *Crear base de datos* (modo producción).
   - **Storage** → *Comenzar*.
5. Pega las reglas de seguridad:
   - Firestore → pestaña **Reglas** → contenido de [`firestore.rules`](firestore.rules).
   - Storage → pestaña **Reglas** → contenido de [`storage.rules`](storage.rules).
   - (Estas reglas garantizan que **cada usuario solo accede a lo suyo**.)
6. En **Authentication → Settings → Dominios autorizados**, agrega el dominio de tu GitHub Pages
   (`baronaarchitect-collab.github.io`) para que el login funcione en producción.

Sube los cambios (`git push`) y listo: la app pasa automáticamente a cuentas reales.

## Correr localmente

```bash
node server.js
```
Abre http://localhost:5190

## Archivos

- `index.html` — la app completa (auth + mapa + subida + OCR + CRM + ajustes).
- `firebase-config.js` — pega aquí tu config de Firebase.
- `firestore.rules` / `storage.rules` — reglas de seguridad (cada quien ve solo lo suyo).
- `server.js` — mini-servidor local para pruebas.

## Notas

- La detección de teléfono usa **OCR (Tesseract.js)** en el navegador; funciona mejor con fotos nítidas de la valla. Siempre puedes corregir el número a mano.
- El botón **Llamar** usa `tel:` → en el **celular** abre el marcador directamente.
- **Agendar visita** genera un enlace a **Google Calendar** con los datos del lote.
