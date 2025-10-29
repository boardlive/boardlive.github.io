# EcoBoard (versión modular)

Aplicación web para compartir una pizarra en tiempo real entre anfitrión e invitados utilizando PeerJS. El código se ha migrado a ES Modules y ahora sigue una arquitectura modular en la que `src/main.js` solo orquesta la inicialización de cada componente.

## Estructura de módulos

- `src/state/appState.js`: almacena un estado único (session, canvas, tools, pages, ui, images) que comparten el resto de módulos.
- `src/dom/domRefs.js`: resuelve y agrupa todos los elementos del DOM que necesitan los módulos.
- `src/modules/toolsModule.js`: lógica de herramientas de dibujo (UI de selección, tamaños, borrador, botón de “↺” para restaurar valores por defecto y opción “Sin relleno” —activada por defecto— para rectángulo/elipse).
- `src/modules/canvasModule.js`: gestiona el lienzo: escalado HiDPI, historial, figuras, imágenes y coordinación con los módulos de páginas y red.
- `src/modules/pagesModule.js`: miniaturas, panel de páginas, importación/exportación de PDF y fullscreen del tablero.
- `src/modules/networkModule.js`: arranca y coordina conexiones PeerJS, difunde eventos y mantiene la sesión host/guest sincronizada.
- `src/modules/uiModule.js`: controla la capa de interfaz (menús, botones, QR, bloqueo de invitados, atajos de teclado) consumiendo los APIs expuestos por los otros módulos.
- `src/utils` y `src/config`: utilidades compartidas y constantes (por ejemplo, márgenes del panel de páginas o configuraciones de PeerJS).

`src/main.js`:
1. obtiene `appState` y `domRefs`;
2. inicializa `toolsModule`, `canvasModule`, `pagesModule`, `uiModule` y `networkModule`;
3. conecta los callbacks entre módulos (p. ej. canvas ↔ red, UI ↔ páginas) y marca la herramienta inicial.

## Puesta en marcha

Es una app estática. Para desarrollo basta con servir la carpeta:

```bash
# Desde la raíz del proyecto
python -m http.server 8080
# o
npx serve .
```

Luego abre `http://localhost:8080` en dos pestañas o dispositivos para validar el flujo host/invitado.

## Checklist de validación manual

- Dibujo local: herramientas, borrador, undo/redo, inserción de imágenes y pruebas con rectángulo/elipse usando el modo “Sin relleno” (activo por defecto y desactivable).
- Gestión de páginas: crear/eliminar, navegar, snapshots automáticos y exportar a PDF.
- Sesión compartida: crear código de anfitrión, invitar y comprobar el bloqueo “Solo anfitrión dibuja”.
- Sincronización visual: que invitados reciban lienzo, fondo, páginas y ajustes de viewport.
- Controles de UI: menús responsive, QR, maximizar/restaurar área de dibujo.

## Próximos pasos opcionales

- Automatizar pruebas (unitarias o E2E) para no depender solo de la verificación manual.
- Documentar comandos adicionales (linting, despliegue) si se incorpora tooling.
- Incorporar un bundler ligero (Vite/Rollup) en caso de necesitar optimizaciones de entrega.

Para más contexto, consulta `por_hacer.md`, que recoge el histórico de la migración y los pendientes restantes.
