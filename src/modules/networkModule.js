import { peerConfig } from '../config/constants.js';
import { rndCode, sanitizeCode } from '../utils/helpers.js';
import {
  toolStrokeColor as defaultToolStrokeColor,
  toolFillColor as defaultToolFillColor,
  getToolSize as defaultGetToolSize,
  isShapeTool as defaultIsShapeTool
} from './toolsModule.js';

const noop = () => {};

export function initNetworkModule({
  appState,
  domRefs,
  canvasApi = {},
  pagesApi = {},
  toolsApi = {},
  uiApi = {}
}) {
  if (!appState) {
    throw new Error('initNetworkModule requires appState');
  }

  const sessionState = appState.session;
  const canvasState = appState.canvas;
  const uiState = appState.ui;
  const pagesState = appState.pages;

  const guests = sessionState.guests;

  const { canvas = null, board = null } = domRefs ?? {};
  const codeInput = domRefs?.inputs?.code ?? null;

  const {
    viewportInfo = () => ({
      width: Math.round(window.innerWidth || 0),
      height: Math.round(window.innerHeight || 0)
    }),
    desiredCanvasHeight = () => Math.max(200, window.innerHeight || 0),
    canvasSnapshot = () => null,
    applySnapshot = noop,
    clearCanvas = noop,
    drawSegment = noop,
    drawShapeOnCanvas = noop,
    beginHistoryAction = noop,
    commitHistoryAction = noop,
    resetHistory = noop,
    updateHistoryUi = noop,
    finalizeActiveImageIfPresent = noop,
    cancelActiveImage = noop,
    drawImageFromDataUrl = () => Promise.resolve(false),
    parsePoint = value => value,
    expandCanvasToViewport = noop,
    setCanvasCssHeight = noop,
    applyCanvasWidth = noop,
    adjustGuestView = noop,
    applyBackgroundColor = noop
  } = canvasApi;

  const {
    getActivePage = () => null,
    renderPageThumbnails = noop,
    schedulePageSnapshot = noop,
    serializePages = () => [],
    setActivePage = noop,
    syncPagesFromHost = noop
  } = pagesApi;

  const {
    setEraserMode = noop,
    toolStrokeColor = defaultToolStrokeColor,
    toolFillColor = defaultToolFillColor,
    getToolSize = defaultGetToolSize,
    isShapeTool = defaultIsShapeTool
  } = toolsApi;

  const {
    setStatus = noop,
    refreshUi = noop,
    applyHostButtonState = noop,
    applyJoinButtonState = noop,
    updateShareLinkUi = noop,
    hideQr = noop
  } = uiApi;

  function requestStateRefresh({ immediate = false } = {}) {
    if (sessionState.isHost) return;
    if (!sessionState.conn || !sessionState.conn.open) return;
    if (immediate) {
      canvasState.cssHeight = null;
      canvasState.cssWidth = null;
    }
    const send = () => {
      if (!sessionState.conn || !sessionState.conn.open) return;
      try {
        const { width, height } = viewportInfo();
        sessionState.conn.send({
          type: 'viewport-info',
          width,
          height
        });
      } catch (err) {
        console.warn('No se pudo enviar viewport-info al anfitrión.', err);
      }
      canvasState.cssHeight = null;
      canvasState.cssWidth = null;
      try {
        sessionState.conn.send({ type: 'request-state' });
      } catch (err) {
        console.warn('No se pudo solicitar el estado al anfitrión.', err);
      }
    };
    if (immediate) {
      send();
      return;
    }
    if (sessionState.stateRequestTimeout !== null) return;
    sessionState.stateRequestTimeout = window.setTimeout(() => {
      sessionState.stateRequestTimeout = null;
      send();
    }, 160);
  }

  function sendStateTo(connection) {
    if (!connection) return;
    try {
      const pagesPayload = serializePages({ refreshActive: true });
      const width = Math.round(
        canvas?.clientWidth ||
          board?.clientWidth ||
          window.innerWidth ||
          0
      );
      const height =
        typeof canvasState.cssHeight === 'number'
          ? canvasState.cssHeight
          : desiredCanvasHeight();
      const activePage = getActivePage();
      connection.send({
        type: 'state',
        h: height,
        w: width,
        bg: uiState.currentBackground,
        lock: sessionState.guestLock,
        pages: pagesPayload,
        activePage: pagesState.activePageId,
        image: activePage?.image || canvasSnapshot()
      });
    } catch (err) {
      console.warn('No se pudo enviar el estado al invitado.', err);
    }
  }

  function broadcast(payload, excludeId = null) {
    if (!sessionState.isHost) return;
    guests.forEach((guestConnection, id) => {
      if (excludeId && id === excludeId) return;
      try {
        if (guestConnection.open) guestConnection.send(payload);
      } catch (err) {
        console.warn('Error al enviar datos a un invitado.', err);
      }
    });
  }

  function broadcastCanvasSnapshot({ image, bg } = {}) {
    if (!sessionState.isHost) return;
    const snapshot = image || canvasSnapshot();
    const background =
      typeof bg === 'string' ? bg : uiState.currentBackground;
    broadcast({
      type: 'canvas',
      image: snapshot,
      bg: background
    });
  }

  function broadcastViewport({ height, width } = {}) {
    if (!sessionState.isHost) return;
    broadcast({
      type: 'viewport',
      h:
        typeof height === 'number'
          ? height
          : canvasState.cssHeight,
      w:
        typeof width === 'number'
          ? width
          : Math.round(
              canvas?.clientWidth ||
                board?.clientWidth ||
                window.innerWidth ||
                0
            )
    });
  }

  function emitClear() {
    if (sessionState.isHost) {
      broadcast({ type: 'clear' });
    } else if (
      sessionState.conn &&
      sessionState.conn.open &&
      !sessionState.remoteLock
    ) {
      try {
        sessionState.conn.send({ type: 'clear' });
      } catch (err) {
        console.warn('No se pudo enviar el evento clear.', err);
      }
    }
  }

  function emitStroke(segment) {
    if (!segment) return;
    if (sessionState.isHost) {
      broadcast({ type: 'stroke', s: segment });
    } else if (
      sessionState.conn &&
      sessionState.conn.open &&
      !sessionState.remoteLock
    ) {
      try {
        sessionState.conn.send({ type: 'stroke', s: segment });
      } catch (err) {
        console.warn('No se pudo enviar el trazo al anfitrión.', err);
      }
    }
  }

  function emitShape(payload) {
    if (!payload || !isShapeTool(payload.shape)) return;
    const start = parsePoint(payload.start);
    const end = parsePoint(payload.end);
    if (!start || !end) return;
    const message = {
      type: 'shape',
      shape: payload.shape,
      start,
      end,
      color: payload.color,
      size: payload.size,
      fill: payload.fill
    };
    if (
      message.fill === undefined &&
      message.shape !== 'rect' &&
      message.shape !== 'ellipse'
    ) {
      delete message.fill;
    }
    if (sessionState.isHost) {
      broadcast(message);
    } else if (
      sessionState.conn &&
      sessionState.conn.open &&
      !sessionState.remoteLock
    ) {
      try {
        sessionState.conn.send(message);
      } catch (err) {
        console.warn('No se pudo enviar la figura al anfitrión.', err);
      }
    }
  }

  function emitImage(payload) {
    if (!payload) return;
    const message = {
      type: 'image',
      dataUrl: payload.dataUrl,
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height
    };
    if (sessionState.isHost) {
      broadcast(message);
    } else if (
      sessionState.conn &&
      sessionState.conn.open &&
      !sessionState.remoteLock
    ) {
      try {
        sessionState.conn.send(message);
      } catch (err) {
        console.warn('No se pudo enviar la imagen al anfitrión.', err);
      }
    }
  }

  function applyBackground(color, propagate = true) {
    applyBackgroundColor(color, propagate);
  }

  function handleIncoming(msg, source) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'stroke': {
        finalizeActiveImageIfPresent();
        const segment = msg.s;
        if (!segment) break;
        drawSegment(segment);
        if (sessionState.isHost) {
          broadcast(msg, source?.peer);
        }
        break;
      }
      case 'clear':
        finalizeActiveImageIfPresent();
        cancelActiveImage();
        clearCanvas();
        if (sessionState.isHost) {
          broadcast(msg, source?.peer);
        }
        break;
      case 'bg':
        finalizeActiveImageIfPresent();
        if (typeof msg.color === 'string') {
          applyBackground(msg.color, false);
        }
        if (sessionState.isHost) {
          broadcast(msg, source?.peer);
        }
        break;
      case 'shape': {
        finalizeActiveImageIfPresent();
        const start = parsePoint(msg.start);
        const end = parsePoint(msg.end);
        if (!start || !end || !msg.shape) break;
        if (sessionState.isHost) beginHistoryAction();
        const fallbackColor = toolStrokeColor(msg.shape);
        const fallbackSize = getToolSize(msg.shape);
        const fill =
          typeof msg.fill === 'string'
            ? msg.fill
            : msg.fill === null
            ? null
            : toolFillColor(msg.shape);
        drawShapeOnCanvas({
          shape: msg.shape,
          start,
          end,
          color:
            typeof msg.color === 'string'
              ? msg.color
              : fallbackColor,
          size: Number.isFinite(msg.size) ? msg.size : fallbackSize,
          fill
        });
        if (!sessionState.isHost) {
          renderPageThumbnails({ force: true });
        }
        if (sessionState.isHost) {
          commitHistoryAction();
          schedulePageSnapshot();
          broadcast(msg, source?.peer);
        }
        break;
      }
      case 'image':
        finalizeActiveImageIfPresent();
        if (typeof msg.dataUrl === 'string') {
          if (sessionState.isHost) beginHistoryAction();
          drawImageFromDataUrl({
            dataUrl: msg.dataUrl,
            x: Number.isFinite(msg.x) ? msg.x : 0,
            y: Number.isFinite(msg.y) ? msg.y : 0,
            width: Number.isFinite(msg.width) ? msg.width : undefined,
            height: Number.isFinite(msg.height) ? msg.height : undefined
          }).then(changed => {
            if (sessionState.isHost) {
              if (changed) {
                commitHistoryAction();
                schedulePageSnapshot();
                broadcast(msg, source?.peer);
              } else {
                canvasState.historyActionStarted = false;
                updateHistoryUi();
              }
            } else if (changed) {
              renderPageThumbnails({ force: true });
            }
          });
        }
        break;
      case 'canvas':
        finalizeActiveImageIfPresent();
        if (!sessionState.isHost && typeof msg.image === 'string') {
          applySnapshot(msg.image);
          if (typeof msg.bg === 'string') {
            applyBackground(msg.bg, false);
          }
        }
        break;
      case 'lock':
        if (typeof msg.value === 'boolean') {
          if (sessionState.isHost) {
            if (source) {
              try {
                source.send({
                  type: 'lock',
                  value: sessionState.guestLock
                });
              } catch (err) {
                console.warn('No se pudo devolver el estado de bloqueo.', err);
              }
            }
          } else {
            sessionState.remoteLock = msg.value;
            refreshUi();
          }
        }
        break;
      case 'state':
        if (!sessionState.isHost) {
          let shouldRefresh = false;
          if (Array.isArray(msg.pages) && msg.pages.length) {
            syncPagesFromHost(msg.pages, msg.activePage || msg.active);
            shouldRefresh = true;
          } else {
            if (msg.bg) applyBackground(msg.bg, false);
            if (msg.image) applySnapshot(msg.image);
            shouldRefresh = true;
          }
          if (typeof msg.lock === 'boolean') {
            sessionState.remoteLock = msg.lock;
            shouldRefresh = true;
          }
          if (Number.isFinite(msg.w)) {
            canvasState.cssWidth = msg.w;
            applyCanvasWidth();
            shouldRefresh = true;
          }
          if (typeof msg.h === 'number') {
            canvasState.cssHeight = msg.h;
            setCanvasCssHeight(canvasState.cssHeight);
            shouldRefresh = true;
          }
          if (shouldRefresh) {
            refreshUi();
            const { width, height } = viewportInfo();
            if (Number.isFinite(width) && Number.isFinite(height)) {
              sessionState.lastGuestViewportSignature = `${width}x${height}`;
            }
          }
        }
        break;
      case 'viewport':
        if (!sessionState.isHost) {
          if (Number.isFinite(msg.w)) {
            canvasState.cssWidth = msg.w;
            applyCanvasWidth();
          }
          if (typeof msg.h === 'number') {
            canvasState.cssHeight = msg.h;
            setCanvasCssHeight(canvasState.cssHeight);
          }
        }
        break;
      case 'pages-sync':
        if (!sessionState.isHost) {
          const pages = Array.isArray(msg.pages) ? msg.pages : [];
          syncPagesFromHost(pages, msg.active);
        }
        break;
      case 'page-change':
        if (!sessionState.isHost && msg?.id) {
          setActivePage(msg.id, { broadcast: false, fromSync: true });
        }
        break;
      case 'request-state':
      case 'hello':
        if (sessionState.isHost && source) {
          sendStateTo(source);
        }
        break;
      case 'viewport-info':
        if (sessionState.isHost && source) {
          if (
            Number.isFinite(msg.width) &&
            Number.isFinite(msg.height)
          ) {
            try {
              source.send({
                type: 'viewport',
                w: msg.width,
                h: msg.height
              });
            } catch (err) {
              console.warn('No se pudo enviar viewport al invitado.', err);
            }
          }
        }
        break;
      default:
        break;
    }
  }

  function cleanupPeer({ hostState = 'idle', guestState = 'idle' } = {}) {
    if (sessionState.peer) {
      try {
        sessionState.peer.destroy();
      } catch (err) {
        console.warn('Error al destruir el peer del anfitrión.', err);
      }
    }
    guests.forEach(connection => {
      try {
        connection.close();
      } catch (err) {
        console.warn('Error al cerrar una conexión de invitado.', err);
      }
    });
    guests.clear();
    sessionState.conn = null;
    sessionState.peer = null;
    sessionState.shareUrl = '';
    updateShareLinkUi();
    hideQr();
    sessionState.isHost = false;
    sessionState.guestLock = true;
    sessionState.remoteLock = false;
    setEraserMode(false);
    cancelActiveImage();
    canvasState.cssWidth = null;
    canvasState.lastViewportHeight = null;
    canvasState.lastViewportWidth = null;
    sessionState.lastGuestViewportSignature = null;
    if (sessionState.stateRequestTimeout !== null) {
      clearTimeout(sessionState.stateRequestTimeout);
      sessionState.stateRequestTimeout = null;
    }
    applyCanvasWidth();
    applyHostButtonState(hostState);
    applyJoinButtonState(guestState);
    setStatus('sin conexión', 'disconnected');
    refreshUi();
    updateHistoryUi();
  }

  function buildShareUrl(code) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('code', code);
      return url.toString();
    } catch (err) {
      console.warn('No se pudo construir la URL de compartición.', err);
      return '';
    }
  }

  function updateStatusForGuests() {
    const count = guests.size;
    if (count > 0) {
      setStatus(`conectados: ${count}`, 'connected');
    } else {
      setStatus('esperando conexiones', 'connected');
    }
  }

  function startHost({ force = false } = {}) {
    const permitted = force || sessionState.allowHostStart;
    sessionState.allowHostStart = false;
    if (!permitted) return;
    cleanupPeer({ hostState: 'idle', guestState: 'idle' });
    const desired = sanitizeCode(codeInput?.value);
    const id = desired || rndCode();
    sessionState.isHost = true;
    sessionState.guestLock = true;
    sessionState.remoteLock = false;
    resetHistory();
    refreshUi();
    applyHostButtonState('pending');
    if (codeInput) codeInput.value = id;
    expandCanvasToViewport(true);
    sessionState.peer = new Peer(id, peerConfig);
    setStatus('creando sesión…', 'pending');
    sessionState.peer.on('open', () => {
      applyHostButtonState('active');
      sessionState.shareUrl = buildShareUrl(id);
      updateShareLinkUi();
      setStatus('esperando conexiones', 'connected');
    });
    sessionState.peer.on('connection', connection => {
      guests.set(connection.peer, connection);
      updateStatusForGuests();
      connection.on('close', () => {
        guests.delete(connection.peer);
        updateStatusForGuests();
      });
      connection.on('data', msg => handleIncoming(msg, connection));
      sendStateTo(connection);
      try {
        connection.send({ type: 'hello' });
      } catch (err) {
        console.warn('No se pudo enviar hello al invitado.', err);
      }
    });
    sessionState.peer.on('disconnected', () => {
      cleanupPeer({ hostState: 'error', guestState: 'idle' });
      setStatus('desconectado', 'disconnected');
    });
    sessionState.peer.on('error', err => {
      console.error(err);
      cleanupPeer({ hostState: 'error', guestState: 'idle' });
      setStatus('error de conexión', 'error');
    });
  }

  function startGuest(code, { silent = false } = {}) {
    const raw = code ?? codeInput?.value ?? '';
    const target = sanitizeCode(raw);
    if (!target) {
      if (!silent) alert('Introduce un código válido.');
      return;
    }
    if (codeInput) codeInput.value = target;
    cleanupPeer({ hostState: 'idle', guestState: 'idle' });
    applyJoinButtonState('pending');
    sessionState.isHost = false;
    sessionState.guestLock = false;
    sessionState.remoteLock = false;
    refreshUi();
    sessionState.peer = new Peer(null, peerConfig);
    setStatus('conectando…', 'pending');
    sessionState.peer.on('open', () => {
      sessionState.conn = sessionState.peer.connect(target, {
        reliable: true
      });
      refreshUi();
      sessionState.conn.on('open', () => {
        setStatus('conectado', 'connected');
        applyJoinButtonState('active');
        refreshUi();
        try {
          sessionState.conn.send({ type: 'request-state' });
        } catch (err) {
          console.warn('No se pudo solicitar el estado inicial.', err);
        }
      });
      sessionState.conn.on('data', msg =>
        handleIncoming(msg, sessionState.conn)
      );
      sessionState.conn.on('close', () => {
        cleanupPeer({ hostState: 'idle', guestState: 'idle' });
        setStatus('cerrado', 'disconnected');
        canvasState.cssWidth = null;
        applyCanvasWidth();
      });
      sessionState.conn.on('error', err => {
        console.error(err);
        cleanupPeer({ hostState: 'idle', guestState: 'error' });
        setStatus('error de conexión', 'error');
        canvasState.cssWidth = null;
        applyCanvasWidth();
        if (!silent) alert('Error en la conexión con el anfitrión.');
      });
    });
    sessionState.peer.on('error', err => {
      console.error(err);
      cleanupPeer({ hostState: 'idle', guestState: 'error' });
      setStatus('error de conexión', 'error');
      if (!silent) alert('No se pudo crear la conexión.');
    });
  }

  function setupAutoStartFromUrl() {
    let codeParam = null;
    try {
      codeParam = new URL(window.location.href)
        .searchParams.get('code');
    } catch (err) {
      codeParam = null;
    }
    if (codeParam) {
      if (codeInput) codeInput.value = codeParam.toUpperCase();
      window.addEventListener('load', () =>
        startGuest(codeParam, { silent: true })
      );
    } else {
      window.addEventListener('load', () => {
        startHost({ force: true });
      });
    }
  }

  setupAutoStartFromUrl();

  return {
    startHost,
    startGuest,
    cleanupPeer,
    broadcast,
    emitStroke,
    emitShape,
    emitImage,
    emitClear,
    broadcastCanvasSnapshot,
    broadcastViewport,
    requestStateRefresh
  };
}
