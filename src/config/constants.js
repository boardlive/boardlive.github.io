export const peerConfig = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:standard.relay.metered.ca:80',
        username: '9745e21b303bdaea589c29bc',
        credential: 'UgG56tBqCEGNjzLY'
      },
      {
        urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
        username: '9745e21b303bdaea589c29bc',
        credential: 'UgG56tBqCEGNjzLY'
      }
    ]
  }
};

export const TOOL_DEFAULTS = {
  pen: { stroke: '#111827', size: 4 },
  line: { stroke: '#f97316', size: 6 },
  arrow: { stroke: '#0f766e', size: 6 },
  text: {
    stroke: '#111827',
    size: 28,
    font: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  },
  rect: { stroke: '#2563eb', fill: '#bfdbfe', size: 5 },
  ellipse: { stroke: '#22c55e', fill: '#bbf7d0', size: 5 },
  highlight: { stroke: '#facc15', size: 20 }
};

export const TOOL_UI_COPY = {
  pen: {
    icon: '✏️',
    title: 'Trazo libre',
    hint: 'Dibuja a mano alzada con precisión.',
    stroke: 'Color del trazo',
    size: 'Grosor (px)',
    showFill: false
  },
  line: {
    icon: '➖',
    title: 'Línea recta',
    hint: 'Arrastra para crear segmentos rectos.',
    stroke: 'Color de la línea',
    size: 'Grosor (px)',
    showFill: false
  },
  arrow: {
    icon: '➡️',
    title: 'Flecha',
    hint: 'Dibuja líneas con punta de flecha.',
    stroke: 'Color de la flecha',
    size: 'Grosor (px)',
    showFill: false
  },
  text: {
    icon: '🔤',
    title: 'Texto',
    hint: 'Haz clic para colocar un cuadro de texto y escribe dentro.',
    stroke: 'Color del texto',
    size: 'Tamaño (px)',
    font: 'Fuente',
    showFill: false
  },
  rect: {
    icon: '⬛',
    title: 'Rectángulo',
    hint: 'Arrastra para crear rectángulos con borde y relleno.',
    stroke: 'Color del borde',
    size: 'Grosor del borde',
    fill: 'Color de relleno',
    showFill: true
  },
  ellipse: {
    icon: '⚪',
    title: 'Círculo o elipse',
    hint: 'Arrastra para crear círculos o elipses.',
    stroke: 'Color del borde',
    size: 'Grosor del borde',
    fill: 'Color de relleno',
    showFill: true
  },
  highlight: {
    icon: '🟡',
    title: 'Resaltador',
    hint: 'Resalta contenido con color semitransparente.',
    stroke: 'Color del resaltador',
    size: 'Ancho (px)',
    showFill: false
  },
  eraser: {
    icon: '🧽',
    title: 'Borrador',
    hint: 'Elimina trazos dibujados en la pizarra.',
    showFill: false
  }
};

export const PAGE_UI_COPY = {
  icon: '📄',
  title: 'Página',
  hint: 'Ajusta el fondo y apariencia de la página actual.'
};

export const HIGHLIGHT_ALPHA = 0.32;
export const PAGE_PANEL_MARGIN = 12;
export const TOOL_SETTINGS_MARGIN = 12;
export const HISTORY_LIMIT = 30;
export const IMAGE_MIN_SIZE = 48;
