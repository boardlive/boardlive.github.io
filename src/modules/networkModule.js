import { peerConfig } from '../config/constants.js';
import { resolveBackgroundSetting } from '../config/backgrounds.js';
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

  const pendingStrokeActions = new Map();

  function nextActionId(prefix = 'act') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }

  function normalizeAuthorId(fallback = null) {
    if (typeof fallback === 'string' && fallback) return fallback;
    if (sessionState.peer?.id) return sessionState.peer.id;
    if (sessionState.clientId) return sessionState.clientId;
    return nextActionId('author');
  }

  function sanitizeSegment(segment = {}) {
    return {
      x0: segment.x0,
      y0: segment.y0,
      cx: segment.cx,
      cy: segment.cy,
      x1: segment.x1,
      y1: segment.y1,
      color: segment.color,
      size: segment.size,
      mode: segment.mode,
      alpha: segment.alpha
    };
  }

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
    performRedo = noop,
    ingestAction = noop,
    setActionActive = () => Promise.resolve(false),
    rebuildCanvasFromHistory = () => Promise.resolve(),
    setBaselineImage = noop
  } = canvasApi;

  const {
    getActivePage = () => null,
    renderPageThumbnails = noop,
    schedulePageSnapshot = noop,
    serializePages = () => [],
    addNewPage = noop,
    removePage = noop,
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
        style: uiState.currentBackground,
        legacyColor: uiState.currentBackground,
        bgColor: uiState.currentBackgroundColor,
        bgPattern: uiState.currentBackgroundPattern,
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

  function emitBackground(background) {
    const resolved = resolveBackgroundSetting(background);
    if (!sessionState.isHost) return;
    const payload = {
      type: 'bg',
      style: resolved.style,
      color: resolved.color,
      pattern: resolved.pattern,
      size: resolved.size,
      image: resolved.image,
      legacyColor: resolved.style,
      bg: {
        style: resolved.style,
        color: resolved.color,
        pattern: resolved.pattern,
        image: resolved.image,
        size: resolved.size
      },
      bgColor: resolved.color,
      bgPattern: resolved.pattern,
      bgSize: resolved.size
    };
    broadcast(payload);
  }

  function broadcastCanvasSnapshot({ image, bg } = {}) {
    if (!sessionState.isHost) return;
    const snapshot = image || canvasSnapshot();
    const background = resolveBackgroundSetting(
      typeof bg === 'object' && bg !== null
        ? bg
        : {
            style:
              typeof bg === 'string' ? bg : uiState.currentBackground,
            pattern:
              typeof bg === 'object' && bg !== null && typeof bg.pattern === 'string'
                ? bg.pattern
                : undefined,
            color:
              typeof bg === 'object' && bg !== null && typeof bg.color === 'string'
                ? bg.color
                : undefined
          }
    );
    broadcast({
      type: 'canvas',
      image: snapshot,
      bg: background.style,
      bgImage: background.image,
      bgSize: background.size,
      legacyColor: background.style,
      style: background.style,
      bgColor: background.color,
      bgPattern: background.pattern
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

  function emitClear(payload = {}) {
    const message = {
      type: 'clear',
      actionId: payload.actionId || nextActionId('clear'),
      authorId: payload.authorId || normalizeAuthorId(),
      pageId: pagesState.activePageId || null
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
        console.warn('No se pudo enviar el evento clear.', err);
      }
    }
  }

  function requestPageAdd({
    afterId = null,
    bg = uiState.currentBackground,
    image = null
  } = {}) {
    const resolved = resolveBackgroundSetting(
      typeof bg === 'object' && bg !== null
        ? bg
        : {
            style: typeof bg === 'string' ? bg : uiState.currentBackground,
            pattern: uiState.currentBackgroundPattern,
            color: uiState.currentBackgroundColor
          }
    );
    if (sessionState.isHost) {
      addNewPage({
        bg: resolved,
        image: typeof image === 'string' ? image : undefined
      });
      return;
    }
    if (!sessionState.conn || !sessionState.conn.open) return;
    const payload = {
      type: 'page-add',
      after:
        typeof afterId === 'string' ? afterId : pagesState.activePageId
    };
    payload.bg = resolved.style;
    payload.bgColor = resolved.color;
    payload.bgPattern = resolved.pattern;
    if (typeof image === 'string' && image.startsWith('data:')) {
      payload.image = image;
    }
    try {
      sessionState.conn.send(payload);
    } catch (err) {
      console.warn('No se pudo solicitar al anfitrión una nueva página.', err);
    }
  }

  function requestPageRemove(id) {
    if (!id) return;
    if (sessionState.isHost) {
      removePage(id);
      return;
    }
    if (!sessionState.conn || !sessionState.conn.open) return;
    try {
      sessionState.conn.send({
        type: 'page-remove',
        id
      });
    } catch (err) {
      console.warn('No se pudo solicitar al anfitrión eliminar una página.', err);
    }
  }

  function requestSetActivePage(id) {
    if (!id) return;
    if (sessionState.isHost) {
      setActivePage(id);
      return;
    }
    if (!sessionState.conn || !sessionState.conn.open) return;
    try {
      sessionState.conn.send({
        type: 'page-set-active',
        id
      });
    } catch (err) {
      console.warn('No se pudo solicitar al anfitrión cambiar de página.', err);
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

  function emitStroke(segment = {}) {
    if (!segment) return;
    const payload = {
      type: 'stroke',
      s: segment,
      actionId: segment.actionId || nextActionId(),
      authorId: segment.authorId || normalizeAuthorId(),
      pageId: pagesState.activePageId || null,
      final: segment.final === true
    };
    payload.s.actionId = payload.actionId;
    payload.s.authorId = payload.authorId;
    payload.s.final = payload.final;
    if (sessionState.isHost) {
      broadcast(payload);
    } else if (
      sessionState.conn &&
      sessionState.conn.open &&
      !sessionState.remoteLock
    ) {
      try {
        sessionState.conn.send(payload);
      } catch (err) {
        console.warn('No se pudo enviar el trazo al anfitrión.', err);
      }
    }
  }

  function notifyActionStateFromCanvas(payload = {}) {
    if (!sessionState.isHost) return;
    const id = payload.id;
    if (!id) return;
    const message = {
      type: 'action-state',
      id,
      active: payload.active !== false,
      authorId: payload.authorId || normalizeAuthorId(),
      pageId: payload.pageId || pagesState.activePageId || null
    };
    broadcast(message, payload.sourcePeerId || null);
  }

  function emitShape(payload = {}) {
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
      fill: payload.fill,
      actionId: payload.actionId || nextActionId('shape'),
      authorId: payload.authorId || normalizeAuthorId(),
      pageId: pagesState.activePageId || null
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

  function emitImage(payload = {}) {
    if (!payload) return;
    const message = {
      type: 'image',
      dataUrl: payload.dataUrl,
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height,
      actionId: payload.actionId || nextActionId('image'),
      authorId: payload.authorId || normalizeAuthorId(),
      pageId: pagesState.activePageId || null
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
        const segment = msg.s || {};
        const actionId =
          segment.actionId || msg.actionId || nextActionId('stroke');
        const authorId =
          segment.authorId ||
          msg.authorId ||
          (source ? source.peer : normalizeAuthorId());
        const pageId = msg.pageId || pagesState.activePageId || null;
        const entryKey = actionId;
        if (!pendingStrokeActions.has(entryKey)) {
          pendingStrokeActions.set(entryKey, {
            id: actionId,
            authorId,
            pageId,
            type: 'stroke',
            segments: []
          });
        }
        const entry = pendingStrokeActions.get(entryKey);
        if (entry) {
          entry.segments.push(sanitizeSegment(segment));
        }
        drawSegment(segment);
        const isFinal = segment.final === true || msg.final === true;
        if (isFinal && entry) {
          pendingStrokeActions.delete(entryKey);
          ingestAction(entry, { apply: false });
        }
        if (sessionState.isHost) {
          const forward = {
            type: 'stroke',
            s: segment,
            actionId,
            authorId,
            pageId,
            final: isFinal
          };
          broadcast(forward, source?.peer);
        }
        break;
      }
      case 'clear':
        finalizeActiveImageIfPresent();
        cancelActiveImage();
        clearCanvas();
        {
          const actionId = msg.actionId || nextActionId('clear');
          const authorId =
            msg.authorId || (source ? source.peer : normalizeAuthorId());
          const pageId = msg.pageId || pagesState.activePageId || null;
          msg.actionId = actionId;
          msg.authorId = authorId;
          msg.pageId = pageId;
          ingestAction(
            {
              id: actionId,
              authorId,
              type: 'clear',
              pageId
            },
            { apply: false }
          );
        }
        if (sessionState.isHost) {
          broadcast(msg, source?.peer);
        }
        break;
      case 'bg': {
        finalizeActiveImageIfPresent();
        const resolved = resolveBackgroundSetting({
          pattern:
            typeof msg.pattern === 'string'
              ? msg.pattern
              : typeof msg.bgPattern === 'string'
              ? msg.bgPattern
              : typeof msg.bg?.pattern === 'string'
              ? msg.bg.pattern
              : undefined,
          style:
            typeof msg.style === 'string'
              ? msg.style
              : typeof msg.bg === 'string'
              ? msg.bg
              : typeof msg.legacyColor === 'string'
              ? msg.legacyColor
              : typeof msg.color === 'string'
              ? msg.color
              : msg.bg?.style,
          color:
            typeof msg.color === 'string'
              ? msg.color
              : typeof msg.bgColor === 'string'
              ? msg.bgColor
              : typeof msg.bg?.color === 'string'
              ? msg.bg.color
              : undefined
        });
        applyBackground(resolved, false);
        if (sessionState.isHost) {
          broadcast(msg, source?.peer);
        }
        break;
      }
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
          if (allowed) {
            const authorId = source ? source.peer : normalizeAuthorId();
            performUndo({
              authorId,
              broadcast: true,
              announce: true,
              sourcePeerId: source?.peer,
              notifyNetwork: false
            });
          }
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
          if (allowed) {
            const authorId = source ? source.peer : normalizeAuthorId();
            performRedo({
              authorId,
              broadcast: true,
              announce: true,
              sourcePeerId: source?.peer,
              notifyNetwork: false
            });
          }
        }
        break;
      case 'action-state': {
        const actionId = msg.id;
        if (!actionId) break;
        const pageId = msg.pageId || pagesState.activePageId || null;
        setActionActive(actionId, msg.active !== false, { pageId }).then(
          () => {
            if (!sessionState.isHost) {
              renderPageThumbnails({ force: true });
            }
          }
        );
        if (sessionState.isHost && source) {
          broadcast(msg, source.peer);
        }
        break;
      }
      case 'shape': {
        finalizeActiveImageIfPresent();
        const start = parsePoint(msg.start);
        const end = parsePoint(msg.end);
        if (!start || !end || !msg.shape) break;
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
        const actionId = msg.actionId || nextActionId('shape');
        const authorId =
          msg.authorId || (source ? source.peer : normalizeAuthorId());
        const pageId = msg.pageId || pagesState.activePageId || null;
        msg.actionId = actionId;
        msg.authorId = authorId;
        msg.pageId = pageId;
        ingestAction(
          {
            id: actionId,
            authorId,
            type: 'shape',
            shape: msg.shape,
            start,
            end,
            color:
              typeof msg.color === 'string' ? msg.color : fallbackColor,
            size: Number.isFinite(msg.size) ? msg.size : fallbackSize,
            fill,
            pageId
          },
          { apply: false }
        );
        if (!sessionState.isHost) {
          renderPageThumbnails({ force: true });
        }
        if (sessionState.isHost) {
          schedulePageSnapshot();
          broadcast(msg, source?.peer);
        }
        break;
      }
      case 'image':
        finalizeActiveImageIfPresent();
        if (typeof msg.dataUrl === 'string') {
          const actionId = msg.actionId || nextActionId('image');
          const authorId =
            msg.authorId || (source ? source.peer : normalizeAuthorId());
          const pageId = msg.pageId || pagesState.activePageId || null;
          msg.actionId = actionId;
          msg.authorId = authorId;
          msg.pageId = pageId;
          const drawPromise = drawImageFromDataUrl({
            dataUrl: msg.dataUrl,
            x: Number.isFinite(msg.x) ? msg.x : 0,
            y: Number.isFinite(msg.y) ? msg.y : 0,
            width: Number.isFinite(msg.width) ? msg.width : undefined,
            height: Number.isFinite(msg.height) ? msg.height : undefined
          });
          drawPromise.then(changed => {
            if (changed) {
              ingestAction(
                {
                  id: actionId,
                  authorId,
                  type: 'image',
                  dataUrl: msg.dataUrl,
                  x: Number.isFinite(msg.x) ? msg.x : 0,
                  y: Number.isFinite(msg.y) ? msg.y : 0,
                  width: Number.isFinite(msg.width) ? msg.width : undefined,
                  height: Number.isFinite(msg.height) ? msg.height : undefined,
                  pageId
                },
                { apply: false }
              );
              if (sessionState.isHost) {
                schedulePageSnapshot();
                broadcast(msg, source?.peer);
              } else {
                renderPageThumbnails({ force: true });
              }
            }
          });
        }
        break;
      case 'canvas':
        finalizeActiveImageIfPresent();
        pendingStrokeActions.clear();
        if (!sessionState.isHost && typeof msg.image === 'string') {
          Promise.resolve(applySnapshot(msg.image)).then(() => {
            resetHistory({ baseImage: msg.image });
            setBaselineImage(msg.image);
          });
          const backgroundPayload =
            typeof msg.style === 'string' ||
            typeof msg.bg === 'string' ||
            (msg.bg && typeof msg.bg === 'object')
              ? resolveBackgroundSetting({
                  style:
                    typeof msg.style === 'string'
                      ? msg.style
                      : typeof msg.bg === 'string'
                      ? msg.bg
                      : typeof msg.legacyColor === 'string'
                      ? msg.legacyColor
                      : typeof msg.color === 'string'
                      ? msg.color
                      : msg.bg?.style,
                  pattern:
                    typeof msg.bgPattern === 'string'
                      ? msg.bgPattern
                      : typeof msg.bg?.pattern === 'string'
                      ? msg.bg.pattern
                      : undefined,
                  color:
                    typeof msg.bgColor === 'string'
                      ? msg.bgColor
                      : typeof msg.color === 'string'
                      ? msg.color
                      : typeof msg.bg?.color === 'string'
                      ? msg.bg.color
                      : undefined
                })
              : null;
          if (backgroundPayload) {
            applyBackground(backgroundPayload, false);
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
          pendingStrokeActions.clear();
          let shouldRefresh = false;
          if (Array.isArray(msg.pages) && msg.pages.length) {
            syncPagesFromHost(msg.pages, msg.activePage || msg.active);
            shouldRefresh = true;
          }
          if (
            typeof msg.style === 'string' ||
            typeof msg.bg === 'string' ||
            (msg.bg && typeof msg.bg === 'object')
          ) {
            const backgroundPayload = resolveBackgroundSetting({
              style:
                typeof msg.style === 'string'
                  ? msg.style
                  : typeof msg.bg === 'string'
                  ? msg.bg
                  : typeof msg.legacyColor === 'string'
                  ? msg.legacyColor
                  : typeof msg.color === 'string'
                  ? msg.color
                  : msg.bg?.style,
              pattern:
                typeof msg.pattern === 'string'
                  ? msg.pattern
                  : typeof msg.bgPattern === 'string'
                  ? msg.bgPattern
                  : typeof msg.bg?.pattern === 'string'
                  ? msg.bg.pattern
                  : undefined,
              color:
                typeof msg.color === 'string'
                  ? msg.color
                  : typeof msg.bgColor === 'string'
                  ? msg.bgColor
                  : typeof msg.bg?.color === 'string'
                  ? msg.bg.color
                  : undefined
            });
            applyBackground(backgroundPayload, false);
            shouldRefresh = true;
          }
          if (typeof msg.image === 'string') {
            Promise.resolve(applySnapshot(msg.image)).then(() => {
              resetHistory({ baseImage: msg.image });
              setBaselineImage(msg.image);
            });
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
      case 'page-add':
        if (sessionState.isHost && source) {
          const entry = getGuestEntry(source.peer);
          if (!entry || !entry.canDraw) break;
          const targetBg = resolveBackgroundSetting({
            style:
              typeof msg.bg === 'string'
                ? msg.bg
                : uiState.currentBackground,
            pattern:
              typeof msg.bgPattern === 'string'
                ? msg.bgPattern
                : undefined,
            color:
              typeof msg.bgColor === 'string'
                ? msg.bgColor
                : undefined
          });
          const targetImage =
            typeof msg.image === 'string' && msg.image.startsWith('data:')
              ? msg.image
              : null;
          const targetPageId =
            typeof msg.after === 'string' ? msg.after : pagesState.activePageId;
          const ensureTargetPage =
            targetPageId && pagesState.activePageId !== targetPageId
              ? Promise.resolve(
                  setActivePage(targetPageId, {
                    broadcast: false,
                    fromSync: true
                  })
                ).catch(() => false)
              : Promise.resolve(true);
          ensureTargetPage.then(() => {
            addNewPage({
              bg: targetBg,
              image: targetImage || undefined
            });
          });
        }
        break;
      case 'page-remove':
        if (sessionState.isHost && source) {
          const entry = getGuestEntry(source.peer);
          if (!entry || !entry.canDraw) break;
          if (typeof msg.id === 'string') {
            removePage(msg.id);
          }
        } else if (!sessionState.isHost) {
          if (typeof msg.id === 'string') {
            removePage(msg.id, { fromSync: true });
          }
        }
        break;
      case 'page-set-active':
        if (sessionState.isHost && source) {
          const entry = getGuestEntry(source.peer);
          if (!entry || !entry.canDraw) break;
          if (typeof msg.id === 'string') {
            setActivePage(msg.id, { broadcast: true, fromSync: false });
          }
        } else if (!sessionState.isHost && typeof msg.id === 'string') {
          setActivePage(msg.id, { broadcast: false, fromSync: true });
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
    pendingStrokeActions.clear();
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
      sessionState.clientId = sessionState.peer?.id || sessionState.clientId;
      applyHostButtonState('active');
      sessionState.shareUrl = buildShareUrl(id);
      updateShareLinkUi();
      setStatus('Esperando conexiones', 'connected');
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
      sessionState.clientId = sessionState.peer?.id || sessionState.clientId;
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
    emitBackground,
    broadcastCanvasSnapshot,
    broadcastViewport,
    requestStateRefresh,
    requestUndo,
    requestRedo,
    requestPageAdd,
    requestPageRemove,
    requestSetActivePage,
    notifyActionStateFromCanvas
  };
}
