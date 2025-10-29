# BoardLive

BoardLive es una pizarra colaborativa en tiempo real pensada para clases, tutorías y talleres. Un anfitrión crea la sesión, comparte el código o un QR y decide quién puede dibujar. Los invitados se conectan desde el navegador, el lienzo se sincroniza automáticamente y todos ven la misma página.

## Características principales

- **Invitación inmediata**: código alfanumérico y enlace/QR generados al iniciar la sesión.
- **Control de permisos**: bloqueo global, autorización individual por invitado y revocación instantánea.
- **Sincronización de vista**: la altura, el zoom y el fondo del lienzo del anfitrión se ajustan en los invitados.
- **Herramientas de dibujo**: trazo libre, resaltador, figuras geométricas, borrador y selector de colores/grosor.
- **Gestión de páginas**: crear/eliminar páginas, miniaturas, importación de PDF, exportación a PDF y fondo configurable.
- **Inserción de imágenes**: carga desde el anfitrión con manipulación directa (mover, redimensionar, rotar).
- **Historial por autor**: deshacer/rehacer independiente por participante y por página.
- **Interfaz adaptable**: cabecera responsiva, modo maximizar y controles accesibles en pantallas táctiles.

## Cómo funciona

1. El anfitrión abre [https://boardlive.github.io](https://boardlive.github.io), pulsa “Compartir mi pizarra” y obtiene un código.
2. Cada invitado introduce el código (o escanea el QR) para unirse en modo lectura.
3. El anfitrión otorga permisos de dibujo de forma individual o activa “todos pueden dibujar”.
4. Los trazos, páginas, fondos e imágenes se sincronizan en tiempo real; el anfitrión puede limpiar, deshacer y exportar a PDF.

## Ejecución local

El proyecto es estático. Para desarrollo basta con servir la carpeta raíz:

```bash
# Desde la raíz del repositorio
python -m http.server 8080
# o
npx serve .
```

Abre `http://localhost:8080` en dos navegadores o dispositivos para probar el flujo anfitrión/invitado.

## Arquitectura técnica

- Código en ES Modules sin bundler, organizado en `src/`.
- `main.js` inicializa módulos de estado, UI, canvas, herramientas, páginas y red.
- Comunicación WebRTC mediante PeerJS con servidores STUN/TURN (definidos en `src/config/constants.js`).
- Estado global único (`src/state/appState.js`) compartido entre módulos para mantener la sincronización.

## Contribuciones

1. Haz un fork y clona el repositorio.
2. Crea una rama descriptiva (`feature/nombre-clarificador`).
3. Mantén el estilo existente (ES Modules, CSS utilitario, sin bundler).
4. Abre un pull request describiendo la mejora o corrección y los pasos para probarla.

Las incidencias y propuestas de mejora pueden registrarse en la pestaña *Issues* del repositorio.
