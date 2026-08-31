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
   - **Storage NO es necesario** — las fotos se guardan comprimidas en Firestore (así evitas el plan de pago Blaze).
5. Pega las reglas de seguridad en Firestore → pestaña **Reglas** → contenido de [`firestore.rules`](firestore.rules).
   (Garantizan que **cada usuario solo accede a lo suyo**.)
6. En **Authentication → Settings → Dominios autorizados**, agrega el dominio de tu GitHub Pages
   (`baronaarchitect-collab.github.io`) para que el login funcione en producción.

Sube los cambios (`git push`) y listo: la app pasa automáticamente a cuentas reales.

## Planes: Gratis vs Pro

- **Gratis:** subir fotos · verlas en el mapa con su ubicación · CRM (WhatsApp + datos del dueño).
- **Pro:** análisis de zona (equipamientos a 5 km) · comparativos por ubicación (Airbnb/Booking/Finca Raíz/Metro Cuadrado) · descargar y enviar el **informe editable (.doc)**.

El plan vive en Firestore: `users/{uid}.plan` = `free` (por defecto) o `pro`.
Las reglas (`firestore.rules`) **impiden que un usuario se auto-active** Pro; solo el admin lo cambia.

### Activar Pro a un usuario (admin)
1. Firebase → Firestore → colección `users` → documento del usuario (su `uid`).
2. Agrega/edita el campo **`plan`** con valor **`pro`** → Guardar.
3. El usuario recarga la app y ya tiene Pro.

### Cobro (opcional, para automatizar)
- Pon un **enlace de pago** (Wompi, Bold, MercadoPago, Stripe…) en **Ajustes → Configuración avanzada → Enlace de pago**.
- El MVP es **manual**: el usuario paga por ese enlace y tú activas su `plan=pro` (paso de arriba).
- Para activación **automática** necesitarías un webhook del proveedor de pago que escriba `plan=pro` (con Firebase requiere Cloud Functions / plan Blaze, o un pequeño servidor).

## Informe editable (.doc)
Tras **Analizar**, en el panel aparecen **📄 Descargar informe** y **✉️ Enviar por correo**.
El informe sigue el *Formato de Análisis de Tierra* (datos del propietario, del terreno, **coordenadas GPS**, vías principales y la tabla **Infraestructura de la zona** con los equipamientos y sus distancias). Se abre y edita en Word.

Para **enviarlo por correo** despliega [`backend/report-mailer.gs`](backend/report-mailer.gs) como app web de Apps Script y pega su URL `/exec` en **Ajustes → Configuración avanzada → Backend de informes**. Sin backend, el botón **descarga** el informe.

## Correr localmente

```bash
node server.js
```
Abre http://localhost:5190

## Archivos

- `index.html` — la app completa (auth + mapa + subida + OCR + CRM + ajustes).
- `firebase-config.js` — pega aquí tu config de Firebase.
- `firestore.rules` — reglas de seguridad (cada quien ve solo lo suyo). Las fotos van comprimidas en Firestore; **no se usa Storage**.
- `server.js` — mini-servidor local para pruebas.

## Notas

- La detección de teléfono usa **OCR (Tesseract.js)** en el navegador; funciona mejor con fotos nítidas de la valla. Siempre puedes corregir el número a mano.
- El botón **Llamar** usa `tel:` → en el **celular** abre el marcador directamente.
- **Agendar visita** genera un enlace a **Google Calendar** con los datos del lote.
