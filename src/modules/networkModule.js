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
    applyBackgroundColor = noop,
    performUndo = noop,
    performRedo = noop
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
    hideQr = noop,
    updateGuestRoster = noop
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

  function sendStateTo(connection, { lockOverride } = {}) {
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
        lock:
          typeof lockOverride === 'boolean'
            ? lockOverride
            : sessionState.guestLock,
        pages: pagesPayload,
        activePage: pagesState.activePageId,
        image: activePage?.image || canvasSnapshot()
      });
    } catch (err) {
      console.warn('No se pudo enviar el estado al invitado.', err);
    }
  }

  function getGuestEntry(id) {
    return guests.get(id) || null;
  }

  function broadcast(payload, excludeId = null) {
    if (!sessionState.isHost) return;
    guests.forEach((guestInfo, id) => {
      if (excludeId && id === excludeId) return;
      const connection = guestInfo?.connection;
      if (!connection) return;
      try {
        if (connection.open) connection.send(payload);
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

  function requestUndo() {
    if (sessionState.isHost) {
      performUndo();
      return;
    }
    if (
      !sessionState.conn ||
      !sessionState.conn.open ||
      sessionState.remoteLock
    )
      return;
    try {
      sessionState.conn.send({ type: 'undo' });
    } catch (err) {
      console.warn('No se pudo solicitar deshacer al anfitrión.', err);
    }
  }

  function requestRedo() {
    if (sessionState.isHost) {
      performRedo();
      return;
    }
    if (
      !sessionState.conn ||
      !sessionState.conn.open ||
      sessionState.remoteLock
    )
      return;
    try {
      sessionState.conn.send({ type: 'redo' });
    } catch (err) {
      console.warn('No se pudo solicitar rehacer al anfitrión.', err);
    }
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

  function defaultGuestName(index) {
    return `Invitado ${index}`;
  }

  function buildGuestDisplayName({ index, customName }) {
    const base = defaultGuestName(index);
    if (customName && customName.trim()) {
      return `${base} (${customName.trim()})`;
    }
    return base;
  }

  function guestRosterSnapshot() {
    const list = Array.from(guests.entries()).map(([id, info]) => ({
      id,
      index: info.index,
      customName: info.customName || '',
      defaultName: defaultGuestName(info.index),
      displayName: buildGuestDisplayName(info),
      canDraw: !!info.canDraw,
      requesting: !!info.requesting
    }));
    list.sort((a, b) => a.index - b.index);
    return {
      total: list.length,
      isHost: sessionState.isHost,
      mode: sessionState.guestAccessMode,
      guestLock: sessionState.guestLock,
      guests: list
    };
  }

  function pushGuestRosterUpdate() {
    updateGuestRoster(guestRosterSnapshot());
  }

  function registerGuestConnection(connection) {
    sessionState.guestCounter += 1;
    const index = sessionState.guestCounter;
    const info = {
      connection,
      index,
      customName: '',
      canDraw: sessionState.guestAccessMode === 'all',
      requesting: false
    };
    guests.set(connection.peer, info);
    return info;
  }

  function removeGuestConnection(id) {
    if (!guests.has(id)) return;
    guests.delete(id);
  }

  function sendLockForEntry(entry) {
    if (!entry) return;
    const connection = entry.connection;
    if (!connection) return;
    const locked = !entry.canDraw;
    try {
      connection.send({ type: 'lock', value: locked });
    } catch (err) {
      console.warn('No se pudo actualizar el permiso de dibujo de un invitado.', err);
    }
  }

  function notifyGuestRequestState(entry) {
    if (!entry) return;
    const connection = entry.connection;
    if (!connection) return;
    try {
      connection.send({
        type: 'request-draw',
        requesting: !!entry.requesting
      });
    } catch (err) {
      console.warn('No se pudo actualizar la solicitud de edición de un invitado.', err);
    }
  }

  function setGuestCanDraw(id, allowed) {
    if (!sessionState.isHost) return;
    const entry = getGuestEntry(id);
    if (!entry) return;
    const target = !!allowed;
    if (entry.canDraw === target) return;
    entry.canDraw = target;
    if (sessionState.guestAccessMode === 'all' && !target) {
      sessionState.guestAccessMode = 'custom';
      sessionState.guestLock = true;
    } else if (target && sessionState.guestAccessMode === 'host-only') {
      sessionState.guestAccessMode = 'custom';
      sessionState.guestLock = true;
    }
    entry.requesting = false;
    sendLockForEntry(entry);
    notifyGuestRequestState(entry);
    pushGuestRosterUpdate();
  }

  function setGuestAccessMode(mode) {
    if (!sessionState.isHost) return;
    const valid = ['host-only', 'all', 'custom'];
    if (!valid.includes(mode)) return;
    if (sessionState.guestAccessMode === mode) return;
    sessionState.guestAccessMode = mode;
    switch (mode) {
      case 'all':
        sessionState.guestLock = false;
        guests.forEach(entry => {
          entry.canDraw = true;
          entry.requesting = false;
          notifyGuestRequestState(entry);
        });
        broadcast({ type: 'lock', value: false });
        break;
      case 'host-only':
        sessionState.guestLock = true;
        guests.forEach(entry => {
          entry.canDraw = false;
          entry.requesting = false;
          notifyGuestRequestState(entry);
        });
        broadcast({ type: 'lock', value: true });
        break;
      case 'custom':
      default:
        sessionState.guestLock = true;
        guests.forEach(entry => {
          sendLockForEntry(entry);
        });
        break;
    }
    pushGuestRosterUpdate();
  }

  function sendGuestName(name) {
    if (sessionState.isHost) return;
    const trimmed = (name ?? '').toString().trim().slice(0, 48);
    if (sessionState.guestName === trimmed) return;
    sessionState.guestName = trimmed;
    if (sessionState.conn && sessionState.conn.open) {
      try {
        sessionState.conn.send({ type: 'guest-name', name: trimmed });
      } catch (err) {
        console.warn('No se pudo enviar el nombre del invitado.', err);
      }
    }
  }

  function setGuestRequestState(requesting) {
    if (sessionState.isHost) return;
    const target = !!requesting;
    if (sessionState.guestRequestPending === target) return;
    sessionState.guestRequestPending = target;
    if (sessionState.conn && sessionState.conn.open) {
      try {
        sessionState.conn.send({ type: 'request-draw', requesting: target });
      } catch (err) {
        console.warn('No se pudo enviar la solicitud de edición.', err);
      }
    }
    refreshUi();
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
      case 'undo':
        if (sessionState.isHost) {
          let allowed = true;
          if (source) {
            if (sessionState.guestAccessMode === 'all') {
              allowed = !sessionState.guestLock;
            } else {
              const entry = getGuestEntry(source.peer);
              allowed = !!entry?.canDraw;
            }
          }
          if (allowed) performUndo();
        }
        break;
      case 'redo':
        if (sessionState.isHost) {
          let allowed = true;
          if (source) {
            if (sessionState.guestAccessMode === 'all') {
              allowed = !sessionState.guestLock;
            } else {
              const entry = getGuestEntry(source.peer);
              allowed = !!entry?.canDraw;
            }
          }
          if (allowed) performRedo();
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
      case 'guest-name':
        if (sessionState.isHost && source) {
          const entry = getGuestEntry(source.peer);
          if (entry) {
            const trimmed = (msg.name ?? '').toString().trim().slice(0, 48);
            entry.customName = trimmed;
            pushGuestRosterUpdate();
          }
        } else if (!sessionState.isHost) {
          sessionState.guestName = (msg.name ?? '').toString().trim().slice(0, 48);
          refreshUi();
        }
        break;
      case 'request-draw':
        if (sessionState.isHost && source) {
          const entry = getGuestEntry(source.peer);
          if (entry) {
            entry.requesting = !!msg.requesting;
            notifyGuestRequestState(entry);
            pushGuestRosterUpdate();
          }
        } else if (!sessionState.isHost) {
          sessionState.guestRequestPending = !!msg.requesting;
          refreshUi();
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
            if (!msg.value) {
              sessionState.guestRequestPending = false;
            }
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
          const entry = getGuestEntry(source.peer);
          const locked =
            entry && sessionState.guestAccessMode !== 'all'
              ? !entry.canDraw
              : sessionState.guestLock;
          sendStateTo(source, { lockOverride: locked });
          try {
            source.send({ type: 'lock', value: locked });
          } catch (err) {
            console.warn('No se pudo enviar el estado de bloqueo al invitado.', err);
          }
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
    guests.forEach(guestInfo => {
      const connection = guestInfo?.connection;
      if (!connection) return;
      try {
        connection.close();
      } catch (err) {
        console.warn('Error al cerrar una conexión de invitado.', err);
      }
    });
    guests.clear();
    sessionState.guestCounter = 0;
    sessionState.guestAccessMode = 'host-only';
    sessionState.guestRequestPending = false;
    pushGuestRosterUpdate();
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
      setStatus(`Invitados conectados: ${count}`, 'connected');
    } else {
      setStatus('Esperando invitados', 'connected');
    }
    pushGuestRosterUpdate();
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
      const info = registerGuestConnection(connection);
      updateStatusForGuests();
      connection.on('close', () => {
        removeGuestConnection(connection.peer);
        updateStatusForGuests();
      });
      connection.on('data', msg => handleIncoming(msg, connection));
      const locked = !info.canDraw;
      sendStateTo(connection, { lockOverride: locked });
      try {
        connection.send({ type: 'lock', value: locked });
      } catch (err) {
        console.warn('No se pudo enviar estado de bloqueo al invitado.', err);
      }
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
        if (sessionState.guestName) {
          try {
            sessionState.conn.send({
              type: 'guest-name',
              name: sessionState.guestName
            });
          } catch (err) {
            console.warn('No se pudo enviar el nombre del invitado al conectar.', err);
          }
        }
        if (sessionState.guestRequestPending) {
          try {
            sessionState.conn.send({
              type: 'request-draw',
              requesting: true
            });
          } catch (err) {
            console.warn('No se pudo reenviar la solicitud de edición al conectar.', err);
          }
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

  pushGuestRosterUpdate();
  setupAutoStartFromUrl();

  return {
    startHost,
    startGuest,
    cleanupPeer,
    setGuestCanDraw,
    setGuestAccessMode,
    sendGuestName,
    setGuestRequestState,
    broadcast,
    emitStroke,
    emitShape,
    emitImage,
    emitClear,
    broadcastCanvasSnapshot,
    broadcastViewport,
    requestStateRefresh,
    requestUndo,
    requestRedo
  };
}
