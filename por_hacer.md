# 📋 Pendientes para completar la modularización de la pizarra digital

Este documento guía a una IA sobre cómo continuar la refactorización hacia arquitectura modular basada en ES Modules. El objetivo final es que `src/main.js` se limite a orquestar módulos independientes, sin lógica compleja ni estado global implícito.

## 1. Consolidar acceso al DOM y estado global
- [x] Usar `collectDomRefs` (`src/dom/domRefs.js`) dentro de `src/main.js` para sustituir los `document.getElementById` y otros selectores declarados al inicio del archivo.
- [x] Leer y escribir el estado desde `appState` (`src/state/appState.js`) en lugar de variables sueltas (`isHost`, `cssHeight`, `toolSettingsOpen`, etc.). Esto implica:
  - Mapear cada variable existente con su homólogo en `appState`.
  - Reemplazar lecturas/escrituras directas por `appState.<grupo>.<propiedad>`.
  - Eliminar las variables globales que queden obsoletas tras la migración.

## 2. Extraer la lógica de herramientas al módulo dedicado
- [x] Completar `initToolsModule` (actualmente en borrador) para que encapsule la lógica de UI, eventos y estado de herramientas:
  - Inicializarlo en `src/main.js`, pasándole las referencias DOM y callbacks necesarios.
  - Reemplazar funciones locales (`updateToolSelection`, `setCurrentTool`, etc.) por los métodos que exponga el módulo.
  - Asegurar que los listeners sobre inputs, botones y paneles de herramientas se registran dentro del módulo y no desde `main`.
- [x] Una vez delegada la lógica, eliminar del archivo principal las funciones duplicadas o cualquier referencia a `TOOL_UI_COPY` y `TOOL_DEFAULTS`.

## 3. Modularizar el canvas y la sincronización de dibujo
- [x] Completar `initCanvasModule` (`src/modules/canvasModule.js`) trasladando:
  - Redimensionamiento HiDPI, sincronización de viewport, undo/redo y flujo completo de dibujo (punteros, borrador, formas, imágenes).
  - Gestión del historial y difusión de cambios (`emitStroke`, `emitShape`, `emitClear`, `emitImage`) desacoplada de PeerJS mediante callbacks.
  - Interacciones con páginas a través de la API inyectada por el módulo de páginas (snapshots, redibujado, fondo).
- [x] Invocar el módulo desde `src/main.js` aportando dependencias (`toolsModule`, `broadcastCanvasSnapshot`, `broadcastViewport`, `requestStateRefresh`).
- [x] Revisar y eliminar cualquier resto de lógica de canvas que aún permanezca en `src/main.js` (listeners, utilidades o estados duplicados).

## 4. Dividir la lógica restante
- [x] Crear módulos adicionales para:
  - [x] **Gestión de páginas/PDF** (`src/modules/pagesModule.js`) ya encapsula miniaturas, importación/exportación, fondo y fullscreen. ✅ Limpieza realizada en `src/main.js`: se eliminaron los listeners de PDF/exportación y ahora todo queda delegado al módulo.
  - [x] **Sincronización PeerJS** implementada en `src/modules/networkModule.js`. ✅ La API expone `startHost`, `startGuest`, `cleanupPeer`, `broadcast*`, `emit*` y `requestStateRefresh`. `src/main.js` ahora solo enruta eventos al módulo mediante proxies.
  - [x] **UI general** (`src/modules/uiModule.js`) centraliza menús, estados de botones, QR, bloqueo de invitado, sanitización del código y atajos de teclado. ✅ `main.js` ahora solo inicializa el módulo y le delega la coordinación con red/canvas/páginas.
- [x] Para cada módulo nuevo:
  - Definir un API público explícito (funciones o métodos) que reciba dependencias por parámetro.
  - Migrar desde `src/main.js` la lógica correspondiente, incluyendo listeners y efectos secundarios.
  - Conectar la comunicación entre módulos mediante callbacks/eventos controlados (evitar referencias cruzadas a variables globales).

## 5. Limpieza final y verificación
- [x] Reducir `src/main.js` a:
  1. Carga de dependencias.
  2. Obtención de referencias DOM/estado.
  3. Inicialización secuencial de módulos.
  4. Wiring de callbacks entre módulos (sin lógica interna extensa).
- [x] Eliminar funciones, constantes o utilidades duplicadas que hayan quedado sin uso tras la migración.
- [ ] Probar manualmente el flujo completo:
  - Dibujo local (herramientas, borrador, undo/redo, figuras con/sin relleno, inserción de imágenes).
  - Gestión de páginas e importación de PDFs.
  - Compartir sesión (host/guest), bloqueo y actualización de fondo.
  - Inserción y manipulación de imágenes.
- [ ] Añadir tests automatizados básicos si es viable (por ejemplo, unit tests sobre módulos de utilidades o estado) para consolidar la nueva arquitectura.

> ⚠️ Importante: mantener las dependencias externas en `index.html` (PeerJS, pdf.js, etc.) y asegurar compatibilidad con navegadores actuales (sin usar sintaxis no soportada por ES Modules nativos).
