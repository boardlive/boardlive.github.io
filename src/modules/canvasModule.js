import {
  HIGHLIGHT_ALPHA,
  HISTORY_LIMIT,
  IMAGE_MIN_SIZE
} from '../config/constants.js';
import { resolveBackgroundSetting } from '../config/backgrounds.js';
import { clamp } from '../utils/helpers.js';
import {
  isShapeTool,
  getToolSize,
  toolStrokeColor,
  toolFillColor,
  getEraserSize
} from './toolsModule.js';

function noop() {}

export function initCanvasModule({
  appState,
  domRefs,
  toolsApi,
  networkApi = {},
  pagesApi = {},
  uiApi = {}
}) {
  if (!appState) {
    throw new Error('initCanvasModule requires appState');
  }
  if (!domRefs?.canvas || !domRefs?.board) {
    throw new Error('initCanvasModule requires canvas and board references');
  }
  if (!toolsApi) {
    throw new Error('initCanvasModule requires toolsApi');
  }

  const sessionState = appState.session;
  const canvasState = appState.canvas;
  const toolsState = appState.tools;
  const uiState = appState.ui;
  const imagesState = appState.images;
  const pagesState = appState.pages;

  canvasState.pendingAction ??= null;
  canvasState.actionLookup ??= new Map();
  canvasState.actionsByPage ??= Object.create(null);
  canvasState.authorStacks ??= Object.create(null);
  canvasState.actionCounter ??= 0;
  canvasState.pageBaselines ??= Object.create(null);

  function ensureClientId() {
    if (sessionState.clientId) return sessionState.clientId;
    let generated = null;
    try {
      if (window?.crypto?.randomUUID) {
        generated = window.crypto.randomUUID();
      }
    } catch (err) {
      // ignore
    }
    if (!generated) {
      generated = `local-${Math.random().toString(36).slice(2, 10)}`;
    }
    sessionState.clientId = generated;
    return sessionState.clientId;
  }

  const localAuthorId = ensureClientId();

  function currentPageId() {
    return pagesState.activePageId || 'default';
  }

  function ensureAuthorStack(authorId = localAuthorId, pageId = currentPageId()) {
    if (!canvasState.authorStacks[authorId]) {
      canvasState.authorStacks[authorId] = Object.create(null);
    }
    const byPage = canvasState.authorStacks[authorId];
    if (!byPage[pageId]) {
      byPage[pageId] = { undo: [], redo: [] };
    }
    return byPage[pageId];
  }

  function authorUndoStack(authorId = localAuthorId, pageId = currentPageId()) {
    return ensureAuthorStack(authorId, pageId).undo;
  }

  function authorRedoStack(authorId = localAuthorId, pageId = currentPageId()) {
    return ensureAuthorStack(authorId, pageId).redo;
  }

  function ensurePageActions(pageId = currentPageId()) {
    if (!canvasState.actionsByPage[pageId]) {
      canvasState.actionsByPage[pageId] = [];
    }
    return canvasState.actionsByPage[pageId];
  }

  function createActionId() {
    canvasState.actionCounter =
      typeof canvasState.actionCounter === 'number'
        ? canvasState.actionCounter + 1
        : 1;
    const base = sessionState.clientId || localAuthorId;
    return `${base}-${Date.now()}-${canvasState.actionCounter}`;
  }

  function recordAction(action) {
    if (!action || !action.id) return;
    action.active = action.active !== false;
    const pageId = action.pageId || currentPageId();
    action.pageId = pageId;
    canvasState.actionLookup.set(action.id, action);
    const pageActions = ensurePageActions(pageId);
    if (!pageActions.includes(action.id)) {
      pageActions.push(action.id);
    }
    const undoStack = authorUndoStack(action.authorId, pageId);
    if (!undoStack.includes(action.id)) {
      undoStack.push(action.id);
      if (undoStack.length > HISTORY_LIMIT) {
        undoStack.shift();
      }
    }
    const redoStack = authorRedoStack(action.authorId, pageId);
    redoStack.length = 0;
  }

  function ingestAction(action, { apply = true } = {}) {
    if (!action || !action.id) return Promise.resolve();
    recordAction(action);
    const shouldApply = apply && action.active !== false;
    const result = shouldApply
      ? applyActionToCanvas(action)
      : Promise.resolve();
    return Promise.resolve(result).then(() => {
      updateHistoryUi();
    });
  }

  function setActionActive(
    actionId,
    active,
    { pageId = currentPageId() } = {}
  ) {
    if (!actionId) return Promise.resolve(false);
    const action = canvasState.actionLookup.get(actionId);
    if (!action) return Promise.resolve(false);
    const targetPageId = action.pageId || pageId;
    action.active = !!active;
    const undoStack = authorUndoStack(action.authorId, targetPageId);
    const redoStack = authorRedoStack(action.authorId, targetPageId);
    if (action.active) {
      removeFromStack(redoStack, actionId);
      if (!undoStack.includes(actionId)) {
        undoStack.push(actionId);
        if (undoStack.length > HISTORY_LIMIT) {
          undoStack.shift();
        }
      }
    } else {
      removeFromStack(undoStack, actionId);
      if (!redoStack.includes(actionId)) {
        redoStack.push(actionId);
        if (redoStack.length > HISTORY_LIMIT) {
          redoStack.shift();
        }
      }
    }
    return rebuildCanvasFromHistory({ pageId: targetPageId, broadcast: false }).then(
      () => true
    );
  }

  function removeFromStack(stack, id) {
    if (!Array.isArray(stack)) return;
    const index = stack.lastIndexOf(id);
    if (index >= 0) stack.splice(index, 1);
  }

  function localUndoStack() {
    return authorUndoStack(localAuthorId, currentPageId());
  }

  function localRedoStack() {
    return authorRedoStack(localAuthorId, currentPageId());
  }

  function getPageActionIds(pageId = currentPageId()) {
    return ensurePageActions(pageId).slice();
  }

  const {
    canvas,
    board,
    header: headerEl,
    buttons = {},
    inputs = {},
    misc = {}
  } = domRefs;

  const {
    undo: undoBtn,
    redo: redoBtn,
    clear: clearBtn,
    insertImage: insertImageBtn,
    openImage: openImageBtn
  } = buttons;

  const { imageFile: imageInput } = inputs;
  const { eraserCursor: eraserCursorEl } = misc;

  const {
    getEffectiveTool,
    setEraserMode,
    updateEraserCursorFromEvent,
    updateEraserCursorSize,
    hideEraserCursor,
    updateEraserLabel,
    updateCanvasCursor
  } = toolsApi;

  const {
    emitStroke = noop,
    emitShape = noop,
    emitClear = noop,
    emitImage = noop,
    emitBackground = noop,
    emitCanvasSnapshot = noop,
    emitViewport = noop,
    requestStateRefresh = noop,
    requestUndo = noop,
    requestRedo = noop,
    notifyActionState = noop
  } = networkApi;

  let pagesScheduleSnapshot =
    typeof pagesApi.scheduleSnapshot === 'function'
      ? pagesApi.scheduleSnapshot
      : noop;
  let pagesSaveCurrentPageState =
    typeof pagesApi.saveCurrentPageState === 'function'
      ? pagesApi.saveCurrentPageState
      : noop;
  let pagesGetActivePage =
    typeof pagesApi.getActivePage === 'function'
      ? pagesApi.getActivePage
      : () => null;
  let pagesRenderThumbnails =
    typeof pagesApi.renderThumbnails === 'function'
      ? pagesApi.renderThumbnails
      : noop;
  let pagesEnsurePanelWithinViewport =
    typeof pagesApi.ensurePanelWithinViewport === 'function'
      ? pagesApi.ensurePanelWithinViewport
      : noop;
  let pagesApplyBackground =
    typeof pagesApi.applyBackground === 'function'
      ? pagesApi.applyBackground
      : noop;

  function registerPagesApi(api = {}) {
    if (typeof api.scheduleSnapshot === 'function') {
      pagesScheduleSnapshot = api.scheduleSnapshot;
    }
    if (typeof api.saveCurrentPageState === 'function') {
      pagesSaveCurrentPageState = api.saveCurrentPageState;
    }
    if (typeof api.getActivePage === 'function') {
      pagesGetActivePage = api.getActivePage;
    }
    if (typeof api.renderThumbnails === 'function') {
      pagesRenderThumbnails = api.renderThumbnails;
    }
    if (typeof api.ensurePanelWithinViewport === 'function') {
      pagesEnsurePanelWithinViewport = api.ensurePanelWithinViewport;
    }
    if (typeof api.applyBackground === 'function') {
      pagesApplyBackground = api.applyBackground;
    }
  }

  registerPagesApi(pagesApi);

  const {
    adjustGuestView: externalAdjustGuestView,
    onHistoryUiChange = noop
  } = uiApi;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  canvasState.lastViewportHeight ??= null;
  canvasState.lastViewportWidth ??= null;
  canvasState.viewportAdjustFrame ??= null;
  canvasState.viewportAdjustTimeout ??= null;
  sessionState.stateRequestTimeout ??= null;
  sessionState.lastGuestViewportSignature ??= null;

  let resizeObserver = null;

  function viewportInfo() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        width: Math.round(
          vv.width || window.innerWidth || canvas?.clientWidth || 0
        ),
        height: Math.round(
          vv.height || window.innerHeight || canvas?.clientHeight || 0
        ),
        scale: vv.scale || 1
      };
    }
    return {
      width: Math.round(window.innerWidth || canvas?.clientWidth || 0),
      height: Math.round(window.innerHeight || canvas?.clientHeight || 0),
      scale: 1
    };
  }

  function headerHeight() {
    return headerEl ? headerEl.offsetHeight : 56;
  }

  function desiredCanvasHeight() {
    const { height } = viewportInfo();
    const viewportHeight = Number.isFinite(height)
      ? height
      : window.innerHeight;
    const value = Math.round(viewportHeight - headerHeight());
    return Math.max(200, value);
  }

  function syncCanvasResolution({ preserve = true } = {}) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    const targetW = Math.max(1, Math.round(w * dpr));
    const targetH = Math.max(1, Math.round(h * dpr));
    if (canvas.width === targetW && canvas.height === targetH) return;
    let snapshot = null;
    if (preserve) {
      try {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (e) {
        // ignore
      }
    }
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    if (snapshot) {
      try {
        ctx.putImageData(snapshot, 0, 0);
      } catch (e) {
        // ignore
      }
    }
  }

  function updateHistoryUi() {
    const undoStack = localUndoStack();
    const redoStack = localRedoStack();
    if (undoBtn) {
      undoBtn.disabled = undoStack.length === 0;
    }
    if (redoBtn) {
      redoBtn.disabled = redoStack.length === 0;
    }
    onHistoryUiChange({ undo: undoStack.length, redo: redoStack.length });
  }

  function canvasSnapshot({ includeBackground = false } = {}) {
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const offCtx = off.getContext('2d');
    offCtx.clearRect(0, 0, off.width, off.height);
    if (includeBackground) {
      const baseColor =
        typeof uiState.currentBackgroundColor === 'string'
          ? uiState.currentBackgroundColor
          : '#ffffff';
      offCtx.fillStyle = baseColor;
      offCtx.fillRect(0, 0, off.width, off.height);
    }
    offCtx.drawImage(canvas, 0, 0);
    return off.toDataURL('image/png');
  }

  function applySnapshot(dataUrl) {
    if (!dataUrl) return Promise.resolve(false);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        syncCanvasResolution({ preserve: false });
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        if (sessionState.isHost) {
          pagesSaveCurrentPageState();
          if (pagesState.pagePanelOpen) {
            pagesRenderThumbnails({ force: true });
          }
        } else {
          pagesRenderThumbnails({ force: true });
        }
        resolve(true);
      };
      img.onerror = () => {
        resolve(false);
      };
      img.src = dataUrl;
    });
  }

  function captureCanvasState() {
    try {
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      return null;
    }
  }

  function restoreCanvasState(state) {
    if (!state) return;
    try {
      ctx.putImageData(state, 0, 0);
    } catch (err) {
      // ignore
    }
  }

  function beginHistoryAction({ type = 'stroke', data = {} } = {}) {
    if (canvasState.historyActionStarted) return;
    const baseData =
      type === 'stroke'
        ? { segments: [] }
        : type === 'shape'
        ? {}
        : type === 'image'
        ? {}
        : {};
    const action = {
      id: createActionId(),
      authorId: localAuthorId,
      pageId: currentPageId(),
      type,
      active: true,
      timestamp: Date.now(),
      ...baseData,
      ...data
    };
    canvasState.pendingAction = action;
    canvasState.historyActionStarted = true;
  }

  function commitHistoryAction({ finalize } = {}) {
    if (!canvasState.historyActionStarted) return;
    const action = canvasState.pendingAction;
    canvasState.pendingAction = null;
    canvasState.historyActionStarted = false;
    if (!action) {
      updateHistoryUi();
      return;
    }
    if (typeof finalize === 'function') {
      finalize(action);
    }
    if (
      (action.type === 'stroke' &&
        (!Array.isArray(action.segments) || action.segments.length === 0)) ||
      (action.type === 'shape' &&
        (!action.start || !action.end || !action.shape))
    ) {
      updateHistoryUi();
      return;
    }
    recordAction(action);
    updateHistoryUi();
  }

  function resetHistory({ baseImage, pageId = currentPageId() } = {}) {
    const actionIds = ensurePageActions(pageId);
    actionIds.forEach(id => {
      const action = canvasState.actionLookup.get(id);
      if (!action) return;
      const stacks = canvasState.authorStacks[action.authorId];
      if (stacks && stacks[pageId]) {
        removeFromStack(stacks[pageId].undo, id);
        removeFromStack(stacks[pageId].redo, id);
      }
      canvasState.actionLookup.delete(id);
    });
    actionIds.length = 0;
    Object.keys(canvasState.authorStacks).forEach(authorId => {
      const entry = canvasState.authorStacks[authorId];
      if (entry && entry[pageId]) {
        entry[pageId].undo = [];
        entry[pageId].redo = [];
      }
    });
    const snapshot =
      typeof baseImage === 'string' && baseImage
        ? baseImage
        : canvasSnapshot();
    canvasState.pageBaselines[pageId] = snapshot;
    canvasState.historyActionStarted = false;
    updateHistoryUi();
  }

  function getBaselineImage(pageId = currentPageId()) {
    return canvasState.pageBaselines[pageId] || null;
  }

  function setBaselineImage(dataUrl, pageId = currentPageId()) {
    if (typeof dataUrl === 'string' && dataUrl) {
      canvasState.pageBaselines[pageId] = dataUrl;
    } else {
      canvasState.pageBaselines[pageId] = null;
    }
  }

  function drawSnapshotFast(dataUrl) {
    if (!dataUrl) {
      clearCanvasPixels();
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        syncCanvasResolution({ preserve: false });
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  async function applyBaseline(pageId = currentPageId()) {
    const base = getBaselineImage(pageId);
    if (base) {
      await drawSnapshotFast(base);
    } else {
      clearCanvas({ skipSnapshot: true });
    }
  }

  async function applyActionToCanvas(action) {
    if (!action || action.active === false) return;
    switch (action.type) {
      case 'stroke':
        if (Array.isArray(action.segments)) {
          action.segments.forEach(seg => drawSegment(seg));
        }
        break;
      case 'shape':
        if (action.shape && action.start && action.end) {
          drawShapeOnCanvas({
            shape: action.shape,
            start: action.start,
            end: action.end,
            color: action.color,
            size: action.size,
            fill: action.fill
          });
        }
        break;
      case 'image':
        if (action.dataUrl) {
          await drawImageFromDataUrl({
            dataUrl: action.dataUrl,
            x: Number.isFinite(action.x) ? action.x : 0,
            y: Number.isFinite(action.y) ? action.y : 0,
            width: Number.isFinite(action.width) ? action.width : undefined,
            height: Number.isFinite(action.height) ? action.height : undefined
          });
        }
        break;
      case 'clear':
        clearCanvasPixels();
        break;
      default:
        break;
    }
  }

  async function rebuildCanvasFromHistory({
    pageId = currentPageId(),
    broadcast = false
  } = {}) {
    await applyBaseline(pageId);
    const ids = getPageActionIds(pageId);
    for (const id of ids) {
      const action = canvasState.actionLookup.get(id);
      if (!action || action.active === false) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyActionToCanvas(action);
    }
    if (sessionState.isHost) {
      pagesScheduleSnapshot();
      if (broadcast) {
        emitCanvasSnapshot({
          image: canvasSnapshot(),
          bg: {
            style: uiState.currentBackground,
            color: uiState.currentBackgroundColor,
            pattern: uiState.currentBackgroundPattern
          }
        });
      }
    } else if (broadcast) {
      emitCanvasSnapshot({
        image: canvasSnapshot(),
        bg: {
          style: uiState.currentBackground,
          color: uiState.currentBackgroundColor,
          pattern: uiState.currentBackgroundPattern
        }
      });
    }
    updateHistoryUi();
  }

  function drawSegment(seg) {
    if (!seg) return;
    ctx.save();
    if (seg.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (seg.mode === 'highlight') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = seg.color;
      ctx.globalAlpha = seg.alpha ?? HIGHLIGHT_ALPHA;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = seg.color;
    }
    ctx.lineWidth = seg.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    if (Number.isFinite(seg.cx) && Number.isFinite(seg.cy)) {
      ctx.quadraticCurveTo(seg.cx, seg.cy, seg.x1, seg.y1);
    } else {
      ctx.lineTo(seg.x1, seg.y1);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawShapeOnCanvas({ shape, start, end, color, size, fill }) {
    if (!shape || !start || !end) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color || '#000000';
    ctx.lineWidth = Number.isFinite(size) ? size : getToolSize(shape);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (shape === 'rect') {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(x, y, w, h);
    } else if (shape === 'ellipse') {
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        Math.max(rx, 0.5),
        Math.max(ry, 0.5),
        0,
        0,
        Math.PI * 2
      );
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          Math.max(rx, 0.5),
          Math.max(ry, 0.5),
          0,
          0,
          Math.PI * 2
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function clearCanvasPixels() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function clearCanvas(options = {}) {
    const { skipSnapshot = false } = options || {};
    cancelActiveImage();
    clearCanvasPixels();
    if (sessionState.isHost) {
      if (!skipSnapshot) pagesScheduleSnapshot();
    }
  }

  function blankPageDataUrl(bg = '#ffffff') {
    const resolved = resolveBackgroundSetting(
      typeof bg === 'object' && bg !== null ? bg : { style: bg }
    );
    const off = document.createElement('canvas');
    off.width = canvas?.width || 1280;
    off.height = canvas?.height || 720;
    const offCtx = off.getContext('2d');
    offCtx.fillStyle = resolved.color;
    offCtx.fillRect(0, 0, off.width, off.height);
    return off.toDataURL('image/png');
  }

  function hasActiveImageOverlay() {
    return !!imagesState.activeImageOverlay && !!imagesState.activeImageState;
  }

  function stopImageInteractionListeners() {
    document.removeEventListener('pointermove', handleImageDragMove);
    document.removeEventListener('pointerup', handleImageDragEnd);
    document.removeEventListener('pointercancel', handleImageDragEnd);
    document.removeEventListener('pointermove', handleImageResizeMove);
    document.removeEventListener('pointerup', handleImageResizeEnd);
    document.removeEventListener('pointercancel', handleImageResizeEnd);
  }

  function applyActiveImageFrame({ x, y, width, height }) {
    if (!imagesState.activeImageOverlay || !imagesState.activeImageState) {
      return;
    }
    imagesState.activeImageState.x = x;
    imagesState.activeImageState.y = y;
    imagesState.activeImageState.width = width;
    imagesState.activeImageState.height = height;
    imagesState.activeImageOverlay.style.left = `${x}px`;
    imagesState.activeImageOverlay.style.top = `${y}px`;
    imagesState.activeImageOverlay.style.width = `${width}px`;
    imagesState.activeImageOverlay.style.height = `${height}px`;
  }

  function handleImageDragMove(e) {
    if (!imagesState.imageDragState) return;
    if (
      e.pointerId !== undefined &&
      e.pointerId !== imagesState.imageDragState.pointerId
    ) {
      return;
    }
    const dx = e.clientX - imagesState.imageDragState.startX;
    const dy = e.clientY - imagesState.imageDragState.startY;
    const x = imagesState.imageDragState.originX + dx;
    const y = imagesState.imageDragState.originY + dy;
    applyActiveImageFrame({
      x,
      y,
      width: imagesState.imageDragState.originWidth,
      height: imagesState.imageDragState.originHeight
    });
    e.preventDefault();
  }

  function handleImageDragEnd(e) {
    if (!imagesState.imageDragState) return;
    if (
      e.pointerId !== undefined &&
      e.pointerId !== imagesState.imageDragState.pointerId
    ) {
      return;
    }
    stopImageInteractionListeners();
    imagesState.imageDragState = null;
  }

  function startImageDrag(e) {
    if (!hasActiveImageOverlay()) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    imagesState.imageDragState = {
      pointerId: e.pointerId ?? 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      originX: imagesState.activeImageState.x,
      originY: imagesState.activeImageState.y,
      originWidth: imagesState.activeImageState.width,
      originHeight: imagesState.activeImageState.height
    };
    if (
      imagesState.activeImageOverlay?.setPointerCapture &&
      e.pointerId !== undefined
    ) {
      try {
        imagesState.activeImageOverlay.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    document.addEventListener('pointermove', handleImageDragMove);
    document.addEventListener('pointerup', handleImageDragEnd);
    document.addEventListener('pointercancel', handleImageDragEnd);
  }

  function handleImageResizeMove(e) {
    if (!imagesState.imageResizeState) return;
    if (
      e.pointerId !== undefined &&
      e.pointerId !== imagesState.imageResizeState.pointerId
    ) {
      return;
    }
    const dx = e.clientX - imagesState.imageResizeState.startX;
    const dy = e.clientY - imagesState.imageResizeState.startY;
    const {
      originX,
      originY,
      originWidth,
      originHeight,
      direction
    } = imagesState.imageResizeState;
    let newX = originX;
    let newY = originY;
    let newWidth = originWidth;
    let newHeight = originHeight;
    if (direction.includes('e')) {
      newWidth = originWidth + dx;
    } else if (direction.includes('w')) {
      newWidth = originWidth - dx;
      newX = originX + dx;
    }
    if (direction.includes('s')) {
      newHeight = originHeight + dy;
    } else if (direction.includes('n')) {
      newHeight = originHeight - dy;
      newY = originY + dy;
    }
    if (newWidth < IMAGE_MIN_SIZE) {
      const rightEdge = originX + originWidth;
      newWidth = IMAGE_MIN_SIZE;
      if (direction.includes('w')) {
        newX = rightEdge - IMAGE_MIN_SIZE;
      }
    }
    if (newHeight < IMAGE_MIN_SIZE) {
      const bottomEdge = originY + originHeight;
      newHeight = IMAGE_MIN_SIZE;
      if (direction.includes('n')) {
        newY = bottomEdge - IMAGE_MIN_SIZE;
      }
    }
    applyActiveImageFrame({
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight
    });
    e.preventDefault();
  }

  function handleImageResizeEnd(e) {
    if (!imagesState.imageResizeState) return;
    if (
      e.pointerId !== undefined &&
      e.pointerId !== imagesState.imageResizeState.pointerId
    ) {
      return;
    }
    stopImageInteractionListeners();
    if (
      imagesState.activeImageOverlay?.releasePointerCapture &&
      e.pointerId !== undefined
    ) {
      try {
        imagesState.activeImageOverlay.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    imagesState.imageResizeState = null;
  }

  function startImageResize(e, direction) {
    if (!hasActiveImageOverlay()) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    imagesState.imageResizeState = {
      pointerId: e.pointerId ?? 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      originX: imagesState.activeImageState.x,
      originY: imagesState.activeImageState.y,
      originWidth: imagesState.activeImageState.width,
      originHeight: imagesState.activeImageState.height,
      direction
    };
    if (
      imagesState.activeImageOverlay?.setPointerCapture &&
      e.pointerId !== undefined
    ) {
      try {
        imagesState.activeImageOverlay.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    imagesState.activeImageOverlay?.setAttribute(
      'data-resizing',
      direction
    );
    document.addEventListener('pointermove', handleImageResizeMove);
    document.addEventListener('pointerup', handleImageResizeEnd);
    document.addEventListener('pointercancel', handleImageResizeEnd);
  }

  function handleActiveImageKeydown(e) {
    if (!hasActiveImageOverlay()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finalizeActiveImage();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelActiveImage();
    }
  }

  function cancelActiveImage() {
    if (!hasActiveImageOverlay()) return false;
    stopImageInteractionListeners();
    document.removeEventListener('keydown', handleActiveImageKeydown);
    imagesState.activeImageOverlay?.remove();
    imagesState.activeImageOverlay = null;
    imagesState.activeImageState = null;
    imagesState.imageResizeState = null;
    imagesState.imageDragState = null;
    return true;
  }

  function finalizeActiveImage({ commit = true } = {}) {
    if (!hasActiveImageOverlay()) return false;
    const state = { ...imagesState.activeImageState };
    stopImageInteractionListeners();
    document.removeEventListener('keydown', handleActiveImageKeydown);
    imagesState.activeImageOverlay?.remove();
    imagesState.activeImageOverlay = null;
    imagesState.activeImageState = null;
    imagesState.imageResizeState = null;
    imagesState.imageDragState = null;
    if (!commit) {
      return true;
    }
    try {
      beginHistoryAction({
        type: 'image',
        data: {
          dataUrl: state.dataUrl,
          x: state.x,
          y: state.y,
          width: state.width,
          height: state.height
        }
      });
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(state.imgEl, state.x, state.y, state.width, state.height);
      ctx.restore();
      const actionId = canvasState.pendingAction?.id;
      commitHistoryAction();
      pagesScheduleSnapshot();
      emitImage({
        dataUrl: state.dataUrl,
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        actionId,
        authorId: localAuthorId
      });
    } catch (err) {
      canvasState.historyActionStarted = false;
      updateHistoryUi();
      return false;
    }
    return true;
  }

  function mountActiveImageOverlay({ dataUrl, img, x, y, width, height }) {
    if (!board || !canvas) return;
    cancelActiveImage();
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.setAttribute('role', 'group');
    overlay.setAttribute(
      'aria-label',
      'Imagen insertada. Arrastra para mover y usa los puntos para redimensionar.'
    );
    overlay.addEventListener('pointerdown', handleActiveImagePointerDown);
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    overlay.addEventListener('dblclick', () => finalizeActiveImage());

    img.classList.add('image-overlay-img');
    img.draggable = false;
    overlay.appendChild(img);

    ['nw', 'ne', 'sw', 'se'].forEach(dir => {
      const handle = document.createElement('span');
      handle.className = `image-overlay-handle image-overlay-handle-${dir}`;
      handle.addEventListener('pointerdown', e => startImageResize(e, dir));
      overlay.appendChild(handle);
    });

    board.appendChild(overlay);
    imagesState.activeImageOverlay = overlay;
    imagesState.activeImageState = {
      dataUrl,
      imgEl: img,
      x,
      y,
      width,
      height
    };
    document.addEventListener('keydown', handleActiveImageKeydown);
  }

  function finalizeActiveImageIfPresent() {
    if (!hasActiveImageOverlay()) return false;
    return finalizeActiveImage();
  }

  function drawImageFromDataUrl({ dataUrl, x = 0, y = 0, width, height } = {}) {
    return new Promise(resolve => {
      if (!dataUrl) {
        resolve(false);
        return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        const w = Number.isFinite(width) ? width : img.width;
        const h = Number.isFinite(height) ? height : img.height;
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
        resolve(true);
      };
      img.onerror = () => {
        resolve(false);
      };
      img.src = dataUrl;
    });
  }

  function handleActiveImagePointerDown(e) {
    startImageDrag(e);
  }

  function placeImageOnCanvas(dataUrl) {
    if (!dataUrl) return;
    finalizeActiveImageIfPresent();
    const img = new Image();
    img.onload = () => {
      const canvasWidth =
        canvas.clientWidth ||
        canvas.width ||
        board?.clientWidth ||
        window.innerWidth ||
        1;
      const canvasHeight =
        canvas.clientHeight ||
        canvas.height ||
        board?.clientHeight ||
        window.innerHeight ||
        1;
      const naturalWidth = img.naturalWidth || img.width || canvasWidth;
      const naturalHeight = img.naturalHeight || img.height || canvasHeight;
      const maxWidth = Math.max(IMAGE_MIN_SIZE, canvasWidth * 0.85);
      const maxHeight = Math.max(IMAGE_MIN_SIZE, canvasHeight * 0.85);
      const scale = Math.min(
        maxWidth / naturalWidth,
        maxHeight / naturalHeight,
        1
      );
      const drawWidth = Math.max(1, naturalWidth * scale);
      const drawHeight = Math.max(1, naturalHeight * scale);
      const x = (canvasWidth - drawWidth) / 2;
      const y = (canvasHeight - drawHeight) / 2;
      mountActiveImageOverlay({
        dataUrl,
        img,
        x,
        y,
        width: drawWidth,
        height: drawHeight
      });
      applyActiveImageFrame({
        x,
        y,
        width: drawWidth,
        height: drawHeight
      });
    };
    img.onerror = () => {
      // ignore
    };
    img.src = dataUrl;
  }

  function parsePoint(input) {
    if (!input) return null;
    if (Array.isArray(input)) {
      const [ax, ay] = input;
      const x = Number(ax);
      const y = Number(ay);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    if (typeof input === 'object') {
      const x = Number(input.x ?? input[0]);
      const y = Number(input.y ?? input[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    if (typeof input === 'string') {
      const parts = input.split(',');
      if (parts.length === 2) {
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      }
    }
    return null;
  }

  function pointerXY(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvasState.canvasScale || 1;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;
    return { x, y };
  }

  function cancelDrawingInteraction() {
    canvasState.drawing = false;
    canvasState.drawingShape = false;
    canvasState.lastPoint = null;
    canvasState.lastMidpoint = null;
    if (canvasState.tempErasePointerId !== null) {
      setEraserMode(canvasState.eraseModeBeforeOverride);
      canvasState.tempErasePointerId = null;
    }
    hideEraserCursor();
    updateCanvasCursor?.();
  }

  function setTouchPanMode(active) {
    const next = !!active;
    if (next === !!canvasState.touchPanActive) return;
    canvasState.touchPanActive = next;
    if (next) {
      cancelDrawingInteraction();
      setEraserMode(false);
    }
  }

  function drawingLocked() {
    return !sessionState.isHost && !!sessionState.remoteLock;
  }

  function down(e) {
    if (e?.pointerType === 'touch' && canvasState.touchPanActive) {
      cancelDrawingInteraction();
      return;
    }
    finalizeActiveImageIfPresent();
    updateEraserCursorFromEvent(e);
    const pointerId = e?.pointerId ?? 'mouse';
    const rightButton =
      e?.button === 2 || (e?.pointerType === 'mouse' && e?.buttons & 2);
    if (rightButton && canvasState.tempErasePointerId === null) {
      canvasState.eraseModeBeforeOverride = canvasState.erasing;
      if (!canvasState.erasing) setEraserMode(true);
      canvasState.tempErasePointerId = pointerId;
    }
    if (drawingLocked()) {
      if (canvasState.tempErasePointerId === pointerId) {
        setEraserMode(canvasState.eraseModeBeforeOverride);
        canvasState.tempErasePointerId = null;
      }
      return;
    }
    if (e?.pointerId !== undefined) {
      canvasState.activePointerId = e.pointerId;
      if (canvas?.setPointerCapture) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          // ignore
        }
      }
    }
    const tool = getEffectiveTool();
    const shapeTool = isShapeTool(tool);
    beginHistoryAction({
      type: shapeTool ? 'shape' : 'stroke',
      data: {
        tool,
        shape: shapeTool ? tool : null,
        erasing: canvasState.erasing,
        segments: []
      }
    });
    const pos = pointerXY(e);
    if (!pos) return;
    if (shapeTool) {
      canvasState.shapeStart = pos;
      canvasState.shapeSnapshot = captureCanvasState();
      canvasState.drawingShape = true;
      canvasState.drawing = false;
    } else {
      canvasState.drawing = true;
      canvasState.drawingShape = false;
      canvasState.lastPoint = pos;
      canvasState.lastMidpoint = pos;
    }
    e.preventDefault();
  }

  function move(e) {
    if (e?.pointerType === 'touch' && canvasState.touchPanActive) return;
    updateEraserCursorFromEvent(e);
    if (canvasState.drawingShape) {
      if (!canvasState.shapeStart) return;
      const pos = pointerXY(e);
      if (!pos) return;
      restoreCanvasState(canvasState.shapeSnapshot);
      const tool = getEffectiveTool();
      const color = toolStrokeColor(tool);
      const size = getToolSize(tool);
      const fill = toolFillColor(tool);
      drawShapeOnCanvas({
        shape: tool,
        start: canvasState.shapeStart,
        end: pos,
        color,
        size,
        fill
      });
      e.preventDefault();
      return;
    }
    if (!canvasState.drawing) return;
    if (drawingLocked()) {
      canvasState.drawing = false;
      return;
    }
    const p = pointerXY(e);
    const tool = getEffectiveTool();
    const toolKey = tool === 'eraser' ? 'pen' : tool;
    const color = canvasState.erasing
      ? '#000000'
      : toolStrokeColor(toolKey);
    const size = canvasState.erasing
      ? getEraserSize()
      : getToolSize(toolKey);
    const mid = {
      x: (canvasState.lastPoint.x + p.x) / 2,
      y: (canvasState.lastPoint.y + p.y) / 2
    };
    const segment = {
      x0: canvasState.lastMidpoint?.x ?? canvasState.lastPoint.x,
      y0: canvasState.lastMidpoint?.y ?? canvasState.lastPoint.y,
      cx: canvasState.lastPoint.x,
      cy: canvasState.lastPoint.y,
      x1: mid.x,
      y1: mid.y,
      color,
      size,
      mode: canvasState.erasing
        ? 'erase'
        : tool === 'highlight'
        ? 'highlight'
        : 'draw',
      alpha: tool === 'highlight' ? HIGHLIGHT_ALPHA : undefined
    };
    drawSegment(segment);
    if (
      canvasState.historyActionStarted &&
      canvasState.pendingAction &&
      canvasState.pendingAction.type === 'stroke'
    ) {
      canvasState.pendingAction.segments.push({ ...segment });
    }
    const actionId = canvasState.pendingAction?.id;
    emitStroke({
      ...segment,
      actionId,
      authorId: localAuthorId,
      final: false
    });
    canvasState.lastPoint = p;
    canvasState.lastMidpoint = mid;
    e.preventDefault();
  }

  function emitShapeEvent(payload) {
    emitShape(payload);
  }

  function up(e) {
    if (e?.pointerType === 'touch' && canvasState.touchPanActive) return;
    updateEraserCursorFromEvent(e);
    const tool = getEffectiveTool();
    if (canvasState.drawingShape) {
      const start = canvasState.shapeStart;
      const pos = e ? pointerXY(e) : start;
      restoreCanvasState(canvasState.shapeSnapshot);
      const color = toolStrokeColor(tool);
      const size = getToolSize(tool);
      const fill = toolFillColor(tool);
      drawShapeOnCanvas({
        shape: tool,
        start,
        end: pos,
        color,
        size,
        fill
      });
      canvasState.drawingShape = false;
      canvasState.shapeStart = null;
      canvasState.shapeSnapshot = null;
      if (canvas?.releasePointerCapture && e?.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          // ignore
        }
      }
      if (
        canvasState.historyActionStarted &&
        canvasState.pendingAction &&
        canvasState.pendingAction.type === 'shape'
      ) {
        Object.assign(canvasState.pendingAction, {
          shape: tool,
          start,
          end: pos,
          color,
          size,
          fill
        });
      }
      const actionId = canvasState.pendingAction?.id;
      commitHistoryAction();
      emitShapeEvent({
        shape: tool,
        start,
        end: pos,
        color,
        size,
        fill,
        actionId,
        authorId: localAuthorId
      });
    } else if (canvasState.drawing) {
      const toolKey = tool === 'eraser' ? 'pen' : tool;
      const color = canvasState.erasing
        ? '#000000'
        : toolStrokeColor(toolKey);
      const size = canvasState.erasing
        ? getEraserSize()
        : getToolSize(toolKey);
      const endPoint = e ? pointerXY(e) : canvasState.lastPoint;
      if (canvasState.lastPoint && canvasState.lastMidpoint && endPoint) {
        const segment = {
          x0: canvasState.lastMidpoint.x,
          y0: canvasState.lastMidpoint.y,
          cx: canvasState.lastPoint.x,
          cy: canvasState.lastPoint.y,
          x1: endPoint.x,
          y1: endPoint.y,
          color,
          size,
          mode: canvasState.erasing
            ? 'erase'
            : tool === 'highlight'
            ? 'highlight'
            : 'draw',
          alpha: tool === 'highlight' ? HIGHLIGHT_ALPHA : undefined
        };
        drawSegment(segment);
        if (
          canvasState.historyActionStarted &&
          canvasState.pendingAction &&
          canvasState.pendingAction.type === 'stroke'
        ) {
          canvasState.pendingAction.segments.push({ ...segment });
        }
        const actionIdFinal = canvasState.pendingAction?.id;
        emitStroke({
          ...segment,
          actionId: actionIdFinal,
          authorId: localAuthorId,
          final: true
        });
      }
      canvasState.drawing = false;
      canvasState.lastPoint = null;
      canvasState.lastMidpoint = null;
      if (canvas?.releasePointerCapture && e?.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          // ignore
        }
      }
      commitHistoryAction();
    }
    if (canvas?.releasePointerCapture && e?.pointerId !== undefined) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    const pointerId = e?.pointerId ?? 'mouse';
    if (
      canvasState.tempErasePointerId !== null &&
      pointerId === canvasState.tempErasePointerId
    ) {
      setEraserMode(canvasState.eraseModeBeforeOverride);
      canvasState.tempErasePointerId = null;
    }
    if (
      e?.pointerId !== undefined &&
      canvasState.activePointerId === e.pointerId
    ) {
      canvasState.activePointerId = null;
    }
    if (e?.type === 'pointerleave') {
      hideEraserCursor();
    }
    if (sessionState.isHost) pagesScheduleSnapshot();
  }

  function handlePointerLeave(e) {
    hideEraserCursor();
    if (canvasState.drawing || canvasState.drawingShape) {
      up(e);
    } else if (canvas) {
      canvas.classList.toggle('erase-mode', canvasState.erasing);
    }
    const pointerId = e?.pointerId ?? 'mouse';
    if (
      canvasState.tempErasePointerId !== null &&
      pointerId === canvasState.tempErasePointerId
    ) {
      setEraserMode(canvasState.eraseModeBeforeOverride);
      canvasState.tempErasePointerId = null;
    }
  }

  function handleTouchStart(e) {
    const touches = e.touches?.length || 0;
    const multi = touches >= 2;
    setTouchPanMode(multi);
    if (!multi) {
      e.preventDefault();
    }
  }

  function handleTouchMove(e) {
    const touches = e.touches?.length || 0;
    const multi = touches >= 2;
    setTouchPanMode(multi);
    if (!multi) {
      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    const touches = e.touches?.length || 0;
    const multi = touches >= 2;
    setTouchPanMode(multi);
  }

  function updateBoardGapIndicator({ availableHeight = 0, availableWidth = 0 } = {}) {
    if (!board) return;
    if (sessionState.isHost) {
      board.classList.remove('board-has-gap');
      return;
    }
    const scale =
      Number.isFinite(canvasState.canvasScale) && canvasState.canvasScale > 0
        ? canvasState.canvasScale
        : 1;
    const cssHeight =
      typeof canvasState.cssHeight === 'number'
        ? canvasState.cssHeight
        : canvas?.offsetHeight || canvas?.clientHeight || 0;
    const cssWidth =
      typeof canvasState.cssWidth === 'number'
        ? canvasState.cssWidth
        : canvas?.offsetWidth || canvas?.clientWidth || 0;
    if (availableHeight <= 0 || availableWidth <= 0 || !cssWidth || !cssHeight) {
      board.classList.remove('board-has-gap');
      return;
    }
    const scaledHeight = cssHeight * scale;
    const scaledWidth = cssWidth * scale;
    const heightGap = Math.max(0, availableHeight - scaledHeight);
    const widthGap = Math.max(0, availableWidth - scaledWidth);
    const threshold = 6;
    const hasGap = heightGap > threshold || widthGap > threshold;
    board.classList.toggle('board-has-gap', hasGap);
  }

  function adjustGuestView() {
    if (typeof externalAdjustGuestView === 'function') {
      externalAdjustGuestView({
        viewportInfo,
        headerHeight: headerHeight(),
        canvas,
        board
      });
      if (canvasState.erasing) updateEraserCursorSize();
      return;
    }
    const { width: viewportWidth, height: rawHeight } = viewportInfo();
    const baseHeight = Number.isFinite(rawHeight)
      ? rawHeight
      : window.innerHeight;
    const headerH = headerHeight();
    const availableHeight = Math.max(200, baseHeight - headerH);
    const availableWidth = viewportWidth || window.innerWidth;
    if (sessionState.isHost) {
      canvasState.canvasScale = 1;
      canvas.style.transform = '';
      canvas.style.transformOrigin = '';
      if (uiState.boardExpanded) {
        board.style.height = `${availableHeight}px`;
        board.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        board.classList.remove('board-has-gap');
      } else {
        board.style.height = '';
        board.style.overflow = 'auto';
        document.body.style.overflow = '';
        board.classList.remove('board-has-gap');
      }
      return;
    }
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
    const targetHeight =
      canvasState.cssHeight ||
      canvas.offsetHeight ||
      availableHeight;
    const targetWidth =
      canvas.offsetWidth ||
      availableWidth ||
      canvas.clientWidth;
    let scale = 1;
    if (targetWidth > 0) {
      const widthScale = availableWidth / targetWidth;
      if (Number.isFinite(widthScale) && widthScale > 0) {
        scale = Math.min(1, widthScale);
      }
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    canvasState.canvasScale = scale;
    if (scale < 1) {
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';
    } else {
      canvas.style.transform = '';
    }
    board.style.height = `${availableHeight}px`;
    board.style.overflow = 'auto';
    document.body.style.overflow = uiState.boardExpanded ? 'hidden' : '';
    updateBoardGapIndicator({ availableHeight, availableWidth });
    if (canvasState.erasing) updateEraserCursorSize();
  }

  function setCanvasCssHeight(h) {
    canvas.style.height = `${h}px`;
    applyCanvasWidth();
    adjustGuestView();
  }

  function applyCanvasWidth() {
    if (typeof canvasState.cssWidth === 'number' && !sessionState.isHost) {
      canvas.style.width = `${canvasState.cssWidth}px`;
      canvas.style.maxWidth = 'none';
    } else {
      canvas.style.width = '';
      canvas.style.removeProperty('max-width');
    }
    syncCanvasResolution({ preserve: true });
    if (canvasState.erasing) updateEraserCursorSize();
  }

  function syncViewportWithGuests() {
    if (!sessionState.isHost) return;
    if (typeof canvasState.cssHeight !== 'number') return;
    const { width: viewportWidth } = viewportInfo();
    const width = Math.round(
      canvas.clientWidth ||
        board.clientWidth ||
        viewportWidth ||
        window.innerWidth ||
        0
    );
    if (width <= 0) return;
    if (
      canvasState.lastViewportHeight === canvasState.cssHeight &&
      canvasState.lastViewportWidth === width
    ) {
      return;
    }
    canvasState.lastViewportHeight = canvasState.cssHeight;
    canvasState.lastViewportWidth = width;
    emitViewport({ height: canvasState.cssHeight, width });
  }

  function expandCanvasToViewport(force = false) {
    const target = desiredCanvasHeight();
    const connected = !!(sessionState.conn && sessionState.conn.open);
    let next = canvasState.cssHeight;
    if (sessionState.isHost) {
      if (canvasState.cssHeight === null || force) next = target;
      if (next !== canvasState.cssHeight) {
        canvasState.cssHeight = next;
        setCanvasCssHeight(canvasState.cssHeight);
        syncViewportWithGuests();
      } else if (force && canvasState.cssHeight !== null) {
        setCanvasCssHeight(canvasState.cssHeight);
        syncViewportWithGuests();
      }
      return;
    }
    if (!connected) {
      if (canvasState.cssHeight === null || force) next = target;
      else if (
        typeof canvasState.cssHeight === 'number' &&
        target > canvasState.cssHeight
      )
        next = target;
      if (next !== canvasState.cssHeight) {
        canvasState.cssHeight = next;
        setCanvasCssHeight(canvasState.cssHeight);
      } else if (force && canvasState.cssHeight !== null) {
        setCanvasCssHeight(canvasState.cssHeight);
      }
    } else if (force && typeof canvasState.cssHeight === 'number') {
      setCanvasCssHeight(canvasState.cssHeight);
    }
  }

  function resizeInternal() {
    syncCanvasResolution({ preserve: true });
  }

  function handleViewportResize(force = false) {
    expandCanvasToViewport(force || sessionState.isHost);
    adjustGuestView();
    pagesEnsurePanelWithinViewport();
  }

  function scheduleViewportAdjust({ force = false, debounce = true } = {}) {
    handleViewportResize(force);
    if (debounce) {
      if (canvasState.viewportAdjustFrame !== null) {
        cancelAnimationFrame(canvasState.viewportAdjustFrame);
        canvasState.viewportAdjustFrame = null;
      }
      canvasState.viewportAdjustFrame = requestAnimationFrame(() => {
        canvasState.viewportAdjustFrame = null;
        handleViewportResize(force);
      });
      if (canvasState.viewportAdjustTimeout !== null) {
        clearTimeout(canvasState.viewportAdjustTimeout);
        canvasState.viewportAdjustTimeout = null;
      }
      canvasState.viewportAdjustTimeout = window.setTimeout(() => {
        canvasState.viewportAdjustTimeout = null;
        handleViewportResize(true);
      }, 260);
    }
    if (!sessionState.isHost && sessionState.conn && sessionState.conn.open) {
      const { width, height } = viewportInfo();
      if (Number.isFinite(width) && Number.isFinite(height)) {
        const signature = `${width}x${height}`;
        const changed = signature !== sessionState.lastGuestViewportSignature;
        if (changed || force) {
          sessionState.lastGuestViewportSignature = signature;
          requestStateRefresh({ immediate: !debounce });
        }
      } else if (force) {
        requestStateRefresh({ immediate: !debounce });
      }
    }
  }

  function performUndo(options = {}) {
    const {
      authorId = localAuthorId,
      pageId = currentPageId(),
      broadcast = sessionState.isHost,
      notifyNetwork = !sessionState.isHost,
      announce = sessionState.isHost,
      sourcePeerId = null
    } = options || {};
    if (!sessionState.isHost) {
      if (notifyNetwork) requestUndo();
      return null;
    }
    finalizeActiveImageIfPresent();
    const stack = authorUndoStack(authorId, pageId);
    if (!stack.length) {
      updateHistoryUi();
      return null;
    }
    const actionId = stack.pop();
    const action = canvasState.actionLookup.get(actionId);
    if (!action) {
      updateHistoryUi();
      return null;
    }
    action.active = false;
    const redoStack = authorRedoStack(authorId, pageId);
    redoStack.push(actionId);
    if (redoStack.length > HISTORY_LIMIT) redoStack.shift();
    rebuildCanvasFromHistory({
      pageId,
      broadcast
    })
      .then(() => {
        if (announce && typeof notifyActionState === 'function') {
          notifyActionState({
            id: actionId,
            active: false,
            authorId,
            pageId,
            sourcePeerId
          });
        }
      })
      .catch(() => {});
    return action;
  }

  function performRedo(options = {}) {
    const {
      authorId = localAuthorId,
      pageId = currentPageId(),
      broadcast = sessionState.isHost,
      notifyNetwork = !sessionState.isHost,
      announce = sessionState.isHost,
      sourcePeerId = null
    } = options || {};
    if (!sessionState.isHost) {
      if (notifyNetwork) requestRedo();
      return null;
    }
    finalizeActiveImageIfPresent();
    const redoStack = authorRedoStack(authorId, pageId);
    if (!redoStack.length) {
      updateHistoryUi();
      return null;
    }
    const actionId = redoStack.pop();
    const action = canvasState.actionLookup.get(actionId);
    if (!action) {
      updateHistoryUi();
      return null;
    }
    action.active = true;
    const undoStack = authorUndoStack(authorId, pageId);
    undoStack.push(actionId);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    rebuildCanvasFromHistory({
      pageId,
      broadcast
    })
      .then(() => {
        if (announce && typeof notifyActionState === 'function') {
          notifyActionState({
            id: actionId,
            active: true,
            authorId,
            pageId,
            sourcePeerId
          });
        }
      })
      .catch(() => {});
    return action;
  }

  function broadcastClear() {
    emitClear();
    if (sessionState.isHost) {
      emitCanvasSnapshot({
        image: canvasSnapshot(),
        bg: {
          style: uiState.currentBackground,
          color: uiState.currentBackgroundColor,
          pattern: uiState.currentBackgroundPattern
        }
      });
    }
  }

  function handleClear() {
    finalizeActiveImageIfPresent();
    beginHistoryAction({ type: 'clear' });
    clearCanvas();
    const actionId = canvasState.pendingAction?.id;
    commitHistoryAction();
    broadcastClear({
      actionId,
      authorId: localAuthorId
    });
  }

  function applyBackgroundColor(input, propagate = true) {
    const resolved = resolveBackgroundSetting(
      typeof input === 'object' && input !== null
        ? input
        : { style: typeof input === 'string' ? input : undefined }
    );
    uiState.currentBackground = resolved.style;
    uiState.currentBackgroundColor = resolved.color;
    uiState.currentBackgroundPattern = resolved.pattern;
    uiState.currentBackgroundImage = resolved.image;
    uiState.currentBackgroundSize = resolved.size;

    const withCacheBuster = value => {
      if (typeof value !== 'string') return value;
      const match = value.match(/^url\((['"]?)(.*?)(\1)\)$/);
      if (!match) return value;
      const quote = match[1] || '';
      const inner = match[2];
      const fragmentIndex = inner.indexOf('#');
      const base = fragmentIndex >= 0 ? inner.slice(0, fragmentIndex) : inner;
      const cacheId = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      return `url(${quote}${base}#${cacheId}${quote})`;
    };

    const colorValue = resolved.color || '#ffffff';
    const imageValue = resolved.image;

    const applyCanvasBackground = () => {
      if (!canvas) return;
      canvas.style.removeProperty('background');
      canvas.style.removeProperty('background-image');
      canvas.style.removeProperty('background-repeat');
      canvas.style.removeProperty('background-position');
      canvas.style.removeProperty('background-attachment');
      canvas.style.removeProperty('background-size');
      if (imageValue) {
        void canvas.offsetHeight;
        canvas.style.backgroundColor = 'transparent';
        canvas.style.backgroundImage = 'none';
      } else {
        canvas.style.backgroundColor = colorValue;
        canvas.style.backgroundImage = 'none';
      }
    };

    const applyBoardBackground = () => {
      if (!board) return;
      board.style.removeProperty('background-size');
      board.style.removeProperty('background-origin');
      board.style.removeProperty('background-attachment');
      board.style.backgroundColor = colorValue;
      if (imageValue) {
        board.style.backgroundImage = 'none';
        void board.offsetHeight;
        const cacheBustedImage = withCacheBuster(imageValue);
        board.style.backgroundImage = cacheBustedImage;
        board.style.backgroundRepeat = 'repeat';
        board.style.backgroundPosition = '0 0';
        if (
          resolved.size &&
          Number.isFinite(resolved.size.width) &&
          Number.isFinite(resolved.size.height)
        ) {
          board.style.backgroundSize = `${resolved.size.width}px ${resolved.size.height}px`;
        }
      } else {
        board.style.backgroundImage = 'none';
        board.style.removeProperty('background-repeat');
        board.style.removeProperty('background-position');
      }
    };

    applyCanvasBackground();
    applyBoardBackground();

    const activePage = pagesGetActivePage();
    if (activePage) {
      activePage.bg = resolved.style;
      activePage.bgColor = resolved.color;
      activePage.bgPattern = resolved.pattern;
      activePage.bgImage = resolved.image;
    }
    if (typeof pagesApplyBackground === 'function') {
      pagesApplyBackground(resolved, propagate);
    }
    if (propagate && typeof emitBackground === 'function') {
      emitBackground(resolved);
    }
    if (sessionState.isHost) pagesScheduleSnapshot();
  }

  function bindEvents() {
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerenter', updateEraserCursorFromEvent);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointercancel', handlePointerLeave);
    canvas.addEventListener('touchstart', handleTouchStart, {
      passive: false
    });
    canvas.addEventListener('touchmove', handleTouchMove, {
      passive: false
    });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, {
      passive: false
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    undoBtn?.addEventListener('click', () => {
      if (undoBtn.disabled) return;
      performUndo();
    });

    redoBtn?.addEventListener('click', () => {
      if (redoBtn.disabled) return;
      performRedo();
    });

    document.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key?.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            performRedo();
          } else {
            performUndo();
          }
        } else if (key === 'y') {
          e.preventDefault();
          performRedo();
        }
      }
    });

    [insertImageBtn, openImageBtn]
      .filter(Boolean)
      .forEach(btn => {
        btn.addEventListener('click', () => {
          if (!sessionState.isHost) {
            alert('Solo el anfitrión puede insertar imágenes.');
            return;
          }
          imageInput?.click();
        });
      });

    imageInput?.addEventListener('change', event => {
      const input = event.target;
      const file =
        input?.files && input.files[0] ? input.files[0] : null;
      if (!file) {
        if (input) input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        placeImageOnCanvas(reader.result);
      };
      reader.onerror = () =>
        alert('No se pudo leer la imagen seleccionada.');
      reader.readAsDataURL(file);
      if (input) input.value = '';
    });

    clearBtn?.addEventListener('click', handleClear);

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => resizeInternal());
      resizeObserver.observe(canvas);
    }

    window.addEventListener('load', () => {
      expandCanvasToViewport(true);
    });

    window.addEventListener('resize', () =>
      scheduleViewportAdjust({ force: false })
    );

    if (window.visualViewport) {
      const visualViewportHandler = () => {
        scheduleViewportAdjust({ force: true });
      };
      window.visualViewport.addEventListener(
        'resize',
        visualViewportHandler
      );
      window.visualViewport.addEventListener(
        'scroll',
        visualViewportHandler
      );
    }

    window.addEventListener('orientationchange', () => {
      scheduleViewportAdjust({ force: true });
      setTimeout(
        () =>
          scheduleViewportAdjust({ force: true, debounce: false }),
        320
      );
    });
  }

  bindEvents();
  updateEraserLabel();
  resetHistory();
  expandCanvasToViewport(true);
  adjustGuestView();

  return {
    viewportInfo,
    desiredCanvasHeight,
    expandCanvasToViewport,
    scheduleViewportAdjust,
    applyCanvasWidth,
    syncCanvasResolution,
    setCanvasCssHeight,
    syncViewportWithGuests,
    canvasSnapshot,
    applySnapshot,
    clearCanvas,
    drawSegment,
    drawShapeOnCanvas,
    beginHistoryAction,
    commitHistoryAction,
    resetHistory,
    updateHistoryUi,
    performUndo,
    performRedo,
    finalizeActiveImageIfPresent,
    cancelActiveImage,
    placeImageOnCanvas,
    drawImageFromDataUrl,
    blankPageDataUrl,
    parsePoint,
    adjustGuestView,
    handleClear,
    applyBackgroundColor,
    registerPagesApi,
    ingestAction,
    setActionActive,
    rebuildCanvasFromHistory,
    setBaselineImage,
    emitStroke,
    emitShape: emitShapeEvent,
    emitImage,
    emitClear: broadcastClear,
    emitCanvasSnapshot,
    destroy() {
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch (err) {
          // ignore
        }
        resizeObserver = null;
      }
      stopImageInteractionListeners();
      document.removeEventListener('keydown', handleActiveImageKeydown);
    }
  };
}
