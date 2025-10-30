import { PAGE_PANEL_MARGIN } from '../config/constants.js';
import { resolveBackgroundSetting } from '../config/backgrounds.js';
import { clamp } from '../utils/helpers.js';

const noop = () => {};

export function initPagesModule({
  appState,
  domRefs,
  canvasApi,
  networkApi = {},
  uiApi = {}
}) {
  if (!appState) {
    throw new Error('initPagesModule requires appState');
  }
  if (!domRefs?.panels?.pagePanel || !domRefs?.panels?.pageThumbnails) {
    throw new Error('initPagesModule requires page panel DOM references');
  }
  if (!canvasApi) {
    throw new Error('initPagesModule requires canvasApi');
  }

  const sessionState = appState.session;
  const pagesState = appState.pages;
  const uiState = appState.ui;
  const canvasState = appState.canvas;
  const pages = pagesState.pages;

  const {
    canvas,
    board,
    panels = {},
    buttons = {},
    inputs = {}
  } = domRefs;

  const {
    pagePanel,
    pageThumbnails,
    pagePanelHead
  } = panels;

  const {
    pageAdd: pageAddBtn,
    pagePrev: pagePrevBtn,
    pageNext: pageNextBtn,
    pageToggle: pageToggleBtn,
    pageClose: pageCloseBtn,
    openPdf: openPdfBtn,
    savePdf: savePdfBtn
  } = buttons;

  const { pdfFile: pdfInput } = inputs;

  const {
    canvasSnapshot = noop,
    applySnapshot = noop,
    clearCanvas = noop,
    syncCanvasResolution = noop,
    finalizeActiveImageIfPresent = noop,
    resetHistory = noop,
    blankPageDataUrl = () => '',
    drawImageFromDataUrl = () => Promise.resolve(false),
    placeImageOnCanvas = noop,
    applyBackgroundColor = noop,
    expandCanvasToViewport = noop,
    desiredCanvasHeight = () => window.innerHeight,
    syncViewportWithGuests = noop
  } = canvasApi;

  const {
    broadcast = noop,
    requestPageAdd = noop,
    requestPageRemove = noop,
    requestSetActivePage = noop
  } = networkApi;
  const {
    onPagePanelToggle = noop,
    onViewToggle = noop,
    onBoardFullscreenChange = noop
  } = uiApi;

  const pagePanelEl = pagePanel;
  const pageThumbnailsEl = pageThumbnails;
  const pagePanelPosition = pagesState.pagePanelPosition;
  const pagePanelDrag = pagesState.pagePanelDrag;
  let fullscreenTarget =
    board?.closest('.wrap') ?? board ?? document.documentElement;

  pagesState.activePageId ??= null;
  pagesState.pageOrderCounter ??= 0;
  pagesState.pagePanelOpen ??= false;
  pagePanelPosition.left ??= null;
  pagePanelPosition.top ??= null;
  pagePanelDrag.active ??= false;
  pagePanelDrag.pointerId ??= null;
  pagePanelDrag.offsetX ??= 0;
  pagePanelDrag.offsetY ??= 0;
  pagePanelDrag.width ??= 0;
  pagePanelDrag.height ??= 0;
  pagesState.pendingSnapshotFrame ??= null;

  function applyPagePanelPosition() {
    if (!pagePanelEl) return;
    if (
      Number.isFinite(pagePanelPosition.left) &&
      Number.isFinite(pagePanelPosition.top)
    ) {
      pagePanelEl.style.left = `${Math.round(pagePanelPosition.left)}px`;
      pagePanelEl.style.top = `${Math.round(pagePanelPosition.top)}px`;
      pagePanelEl.style.right = 'auto';
      pagePanelEl.style.bottom = 'auto';
    } else {
      pagePanelEl.style.left = '';
      pagePanelEl.style.top = '';
      pagePanelEl.style.right = '';
      pagePanelEl.style.bottom = '';
    }
  }

  function ensurePagePanelWithinViewport() {
    if (!pagePanelEl || pagePanelEl.hasAttribute('hidden')) return;
    const rect = pagePanelEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const width = rect.width;
    const height = rect.height;
    const maxLeft = Math.max(
      PAGE_PANEL_MARGIN,
      window.innerWidth - width - PAGE_PANEL_MARGIN
    );
    const maxTop = Math.max(
      PAGE_PANEL_MARGIN,
      window.innerHeight - height - PAGE_PANEL_MARGIN
    );
    let adjusted = false;
    if (left < PAGE_PANEL_MARGIN) {
      left = PAGE_PANEL_MARGIN;
      adjusted = true;
    } else if (left > maxLeft) {
      left = maxLeft;
      adjusted = true;
    }
    if (top < PAGE_PANEL_MARGIN) {
      top = PAGE_PANEL_MARGIN;
      adjusted = true;
    } else if (top > maxTop) {
      top = maxTop;
      adjusted = true;
    }
    if (adjusted || Number.isFinite(pagePanelPosition.left)) {
      pagePanelPosition.left = left;
      pagePanelPosition.top = top;
      applyPagePanelPosition();
    }
  }

  function setPagePanelDragging(active) {
    if (!pagePanelEl) return;
    if (active) {
      pagePanelEl.dataset.dragging = 'true';
    } else {
      delete pagePanelEl.dataset.dragging;
    }
  }

  function startPagePanelDrag(e) {
    if (!pagePanelEl) return;
    const isPrimary = e.button === undefined || e.button === 0;
    if (!isPrimary) return;
    if (e.target && e.target.closest('button')) return;
    const rect = pagePanelEl.getBoundingClientRect();
    pagePanelPosition.left = rect.left;
    pagePanelPosition.top = rect.top;
    applyPagePanelPosition();
    pagePanelDrag.active = true;
    pagePanelDrag.pointerId = e.pointerId ?? 'mouse';
    pagePanelDrag.offsetX = e.clientX - rect.left;
    pagePanelDrag.offsetY = e.clientY - rect.top;
    pagePanelDrag.width = rect.width;
    pagePanelDrag.height = rect.height;
    if (pagePanelEl.setPointerCapture && e.pointerId !== undefined) {
      try {
        pagePanelEl.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    setPagePanelDragging(true);
    e.preventDefault();
  }

  function updatePagePanelDrag(e) {
    if (!pagePanelDrag.active) return;
    if (
      pagePanelDrag.pointerId !== 'mouse' &&
      e.pointerId !== undefined &&
      e.pointerId !== pagePanelDrag.pointerId
    )
      return;
    const width = pagePanelDrag.width || pagePanelEl?.offsetWidth || 0;
    const height = pagePanelDrag.height || pagePanelEl?.offsetHeight || 0;
    const maxLeft = Math.max(
      PAGE_PANEL_MARGIN,
      window.innerWidth - width - PAGE_PANEL_MARGIN
    );
    const maxTop = Math.max(
      PAGE_PANEL_MARGIN,
      window.innerHeight - height - PAGE_PANEL_MARGIN
    );
    const baseLeft = e.clientX - pagePanelDrag.offsetX;
    const baseTop = e.clientY - pagePanelDrag.offsetY;
    pagePanelPosition.left = clamp(
      baseLeft,
      PAGE_PANEL_MARGIN,
      maxLeft
    );
    pagePanelPosition.top = clamp(baseTop, PAGE_PANEL_MARGIN, maxTop);
    applyPagePanelPosition();
    e.preventDefault();
  }

  function endPagePanelDrag(e) {
    if (!pagePanelDrag.active) return;
    if (
      pagePanelDrag.pointerId !== 'mouse' &&
      e.pointerId !== undefined &&
      e.pointerId !== pagePanelDrag.pointerId
    )
      return;
    pagePanelDrag.active = false;
    pagePanelDrag.pointerId = null;
    pagePanelDrag.offsetX = 0;
    pagePanelDrag.offsetY = 0;
    if (pagePanelEl?.releasePointerCapture && e.pointerId !== undefined) {
      try {
        pagePanelEl.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    setPagePanelDragging(false);
    e.preventDefault();
  }

  function setPagePanelOpen(open) {
    const desired = !!open;
    if (pagesState.pagePanelOpen === desired) return;
    pagesState.pagePanelOpen = desired;
    if (pagePanelEl) {
      if (desired) {
        pagePanelEl.removeAttribute('hidden');
        applyPagePanelPosition();
        ensurePagePanelWithinViewport();
        renderPageThumbnails();
      } else {
        setPagePanelDragging(false);
        pagePanelEl.setAttribute('hidden', '');
      }
    }
    if (pageToggleBtn) {
      pageToggleBtn.setAttribute('aria-expanded', desired ? 'true' : 'false');
      pageToggleBtn.setAttribute(
        'aria-label',
        desired ? 'Ocultar páginas' : 'Mostrar páginas'
      );
    }
    onPagePanelToggle(desired);
  }

  function fullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  }

  function isBoardFullscreen() {
    const el = fullscreenElement();
    return !!el && el === fullscreenTarget;
  }

  async function enterBoardFullscreen() {
    const target =
      board?.closest('.wrap') ?? board ?? document.documentElement;
    fullscreenTarget = target;
    if (!target) return;
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' });
        handleFullscreenChange();
        return;
      }
    } catch (err) {
      console.warn('No se pudo activar pantalla completa estándar:', err);
    }
    const fallback =
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen;
    if (typeof fallback === 'function') {
      try {
        fallback.call(target);
        setTimeout(handleFullscreenChange, 0);
      } catch (err) {
        console.warn('No se pudo activar pantalla completa (fallback):', err);
      }
    } else {
      alert('Este navegador no permite la pantalla completa desde la aplicación.');
    }
  }

  function exitBoardFullscreen() {
    if (!isBoardFullscreen()) {
      uiState.boardExpanded = false;
      delete document.body.dataset.boardExpanded;
      updateViewToggle();
      expandCanvasToViewport(true);
      ensurePagePanelWithinViewport();
      return;
    }
    if (document.exitFullscreen) {
      document
        .exitFullscreen()
        .catch(err => {
          console.warn('Error al salir de pantalla completa:', err);
        })
        .finally(() => handleFullscreenChange());
      return;
    }
    const fallback =
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (typeof fallback === 'function') {
      try {
        fallback.call(document);
        setTimeout(handleFullscreenChange, 0);
      } catch (err) {
        console.warn('No se pudo salir de pantalla completa (fallback):', err);
      }
    }
  }

  function handleFullscreenChange() {
    const active = isBoardFullscreen();
    uiState.boardExpanded = active;
    if (active) {
      document.body.dataset.boardExpanded = 'true';
    } else {
      delete document.body.dataset.boardExpanded;
    }
    onBoardFullscreenChange({
      active,
      pagePanelOpen: pagesState.pagePanelOpen
    });
    updateViewToggle();
    expandCanvasToViewport(true);
    ensurePagePanelWithinViewport();
  }

  function updateViewToggle() {
    // This helper remains for compatibility; UI module may override later.
    onViewToggle(uiState.boardExpanded);
  }

  function generatePageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `page-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function createPage({
    id = generatePageId(),
    bg = undefined,
    bgPattern = undefined,
    bgColor = undefined,
    bgImage = undefined,
    bgSize = undefined,
    image = null,
    order = null
  } = {}) {
    const styleFromBg =
      typeof bg === 'string'
        ? bg
        : typeof bg?.style === 'string'
        ? bg.style
        : undefined;
    const patternHint =
      typeof bg?.pattern === 'string'
        ? bg.pattern
        : typeof bgPattern === 'string'
        ? bgPattern
        : undefined;
    const colorHint =
      typeof bg?.color === 'string'
        ? bg.color
        : typeof bgColor === 'string'
        ? bgColor
        : undefined;
    const resolved = resolveBackgroundSetting({
      style: styleFromBg ?? uiState.currentBackground,
      pattern: patternHint ?? (styleFromBg ? undefined : uiState.currentBackgroundPattern),
      color: colorHint ?? (styleFromBg ? undefined : uiState.currentBackgroundColor)
    });
    pagesState.pageOrderCounter = Math.max(
      pagesState.pageOrderCounter,
      order ?? pagesState.pageOrderCounter
    );
    const imageValue =
      typeof bgImage === 'string' && bgImage.includes('url(')
        ? bgImage.trim()
        : resolved.image ?? null;
    const sizeValue =
      bgSize && typeof bgSize === 'object'
        ? {
            width: Number(bgSize.width) || null,
            height: Number(bgSize.height) || null
          }
        : resolved.size || null;
    return {
      id,
      bg: resolved.style,
      bgColor: resolved.color,
      bgPattern: resolved.pattern,
      bgImage: imageValue,
      bgSize: sizeValue,
      image: image ?? null,
      order: order ?? ++pagesState.pageOrderCounter
    };
  }

  function getActivePage() {
    return pages.find(page => page.id === pagesState.activePageId) || null;
  }

  function findPageIndex(id) {
    return pages.findIndex(page => page.id === id);
  }

  function updatePageNavButtons() {
    if (!pagePrevBtn || !pageNextBtn) return;
    const idx = findPageIndex(pagesState.activePageId);
    if (pages.length <= 1 || idx <= 0) {
      pagePrevBtn.setAttribute('disabled', 'true');
    } else {
      pagePrevBtn.removeAttribute('disabled');
    }
    if (pages.length <= 1 || idx === pages.length - 1) {
      pageNextBtn.setAttribute('disabled', 'true');
    } else {
      pageNextBtn.removeAttribute('disabled');
    }
  }

  function renderPageThumbnails({ force = false } = {}) {
    if (!pageThumbnailsEl) return;
    if (!pagesState.pagePanelOpen && !force) return;
    pageThumbnailsEl.innerHTML = '';
    if (pages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'page-empty-thumb';
      empty.textContent = 'Sin páginas';
      pageThumbnailsEl.appendChild(empty);
      updatePageNavButtons();
      return;
    }
    pages.forEach((page, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'page-thumb-wrap';
      wrap.dataset.pageId = page.id;
      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = 'page-thumb';
      thumbBtn.dataset.pageId = page.id;
      if (page.bg) {
        thumbBtn.style.background = page.bg;
      } else {
        thumbBtn.style.background = '#ffffff';
      }
      const isActive = page.id === pagesState.activePageId;
      thumbBtn.dataset.active = isActive ? 'true' : 'false';
      thumbBtn.dataset.hasImg = page.image ? 'true' : 'false';
      if (page.image) {
        const img = document.createElement('img');
        img.alt = `Miniatura página ${idx + 1}`;
        img.src = page.image;
        thumbBtn.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'page-empty-thumb';
        placeholder.textContent = 'Vacía';
        thumbBtn.appendChild(placeholder);
      }
      const label = document.createElement('span');
      label.className = 'page-thumb-label';
      label.textContent = `Pág ${idx + 1}`;
      thumbBtn.appendChild(label);
      wrap.appendChild(thumbBtn);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'page-thumb-delete';
      delBtn.dataset.pageId = page.id;
      delBtn.title = 'Eliminar página';
      delBtn.innerHTML = '×';
      if (pages.length <= 1) {
        delBtn.setAttribute('disabled', 'true');
      }
      wrap.appendChild(delBtn);
      pageThumbnailsEl.appendChild(wrap);
    });
    updatePageNavButtons();
  }

  function saveCurrentPageState() {
    finalizeActiveImageIfPresent();
    const page = getActivePage();
    if (!page || !canvas) return;
    syncCanvasResolution({ preserve: true });
    page.bg = uiState.currentBackground;
    page.bgColor = uiState.currentBackgroundColor;
    page.bgPattern = uiState.currentBackgroundPattern;
    page.bgImage = uiState.currentBackgroundImage ?? null;
    page.bgSize = uiState.currentBackgroundSize
      ? {
          width: uiState.currentBackgroundSize.width ?? null,
          height: uiState.currentBackgroundSize.height ?? null
        }
      : null;
    page.image = canvasSnapshot();
  }

  function schedulePageSnapshot() {
    if (!sessionState.isHost) return;
    if (pagesState.pendingSnapshotFrame !== null) return;
    pagesState.pendingSnapshotFrame = requestAnimationFrame(() => {
      pagesState.pendingSnapshotFrame = null;
      saveCurrentPageState();
      renderPageThumbnails();
    });
  }

  function snapshotForPage(page) {
    if (!page) return null;
    if (page.id === pagesState.activePageId) {
      saveCurrentPageState();
      return page.image;
    }
    if (page.image) return page.image;
    return blankPageDataUrl({
      style: page.bg,
      color: page.bgColor,
      pattern: page.bgPattern
    });
  }

  function serializePages({ refreshActive = false } = {}) {
    if (refreshActive) saveCurrentPageState();
    return pages.map(page => ({
      id: page.id,
      bg: page.bg,
      bgColor: page.bgColor,
      bgPattern: page.bgPattern,
      bgImage: page.bgImage ?? null,
      bgSize: page.bgSize ?? null,
      order: page.order,
      image: page.image || (sessionState.isHost ? canvasSnapshot() : null)
    }));
  }

  function broadcastPages() {
    if (!sessionState.isHost) return;
    const payload = {
      type: 'pages-sync',
      pages: serializePages({ refreshActive: true }),
      active: pagesState.activePageId
    };
    broadcast(payload);
  }

  function broadcastPageChange(id) {
    if (!sessionState.isHost) return;
    if (!id) return;
    broadcast({ type: 'page-change', id });
  }

  function applyPageToCanvas(page) {
    if (!page) {
      applyBackgroundColor(
        { style: '#ffffff', pattern: 'solid', color: '#ffffff' },
        false
      );
      clearCanvas();
      return Promise.resolve(false);
    }
    const resolved = resolveBackgroundSetting({
      style: page.bg,
      pattern: page.bgPattern,
      color: page.bgColor
    });
    applyBackgroundColor(resolved, false);
    if (page.image) {
      return applySnapshot(page.image);
    }
    clearCanvas();
    return Promise.resolve(true);
  }

  function setActivePage(
    id,
    { broadcast: shouldBroadcast = true, fromSync = false } = {}
  ) {
    if (!id) return Promise.resolve(false);
    const isSamePage = pagesState.activePageId === id;
    if (!sessionState.isHost && !fromSync) {
      if (!isSamePage) requestSetActivePage(id);
      return Promise.resolve(isSamePage);
    }
    finalizeActiveImageIfPresent();
    if (isSamePage && !fromSync) {
      if (sessionState.isHost && shouldBroadcast) broadcastPages();
      return Promise.resolve(true);
    }
    if (sessionState.isHost && !fromSync) {
      saveCurrentPageState();
    }
    const page = pages.find(p => p.id === id);
    if (!page) return Promise.resolve(false);
    pagesState.activePageId = id;
    const renderPromise = Promise.resolve(applyPageToCanvas(page));
    resetHistory();
    renderPageThumbnails({ force: true });
    if (sessionState.isHost && shouldBroadcast) {
      renderPromise.then(() => {
        broadcastPages();
        broadcastPageChange(pagesState.activePageId);
        syncViewportWithGuests();
      });
    }
    return renderPromise;
  }

  function addNewPage({ bg, image } = {}) {
    const resolved =
      typeof bg === 'object' && bg !== null
        ? resolveBackgroundSetting(bg)
        : resolveBackgroundSetting({
            style: typeof bg === 'string' ? bg : uiState.currentBackground,
            pattern: uiState.currentBackgroundPattern,
            color: uiState.currentBackgroundColor
          });
    if (!sessionState.isHost) {
      requestPageAdd({
        afterId: pagesState.activePageId,
        bg: resolved,
        image
      });
      return;
    }
    finalizeActiveImageIfPresent();
    if (sessionState.isHost) saveCurrentPageState();
    const newPage = createPage({ bg: resolved, image });
    const currentIndex = findPageIndex(pagesState.activePageId);
    const insertAt = currentIndex >= 0 ? currentIndex + 1 : pages.length;
    pages.splice(insertAt, 0, newPage);
    const renderPromise = setActivePage(newPage.id, { broadcast: false });
    if (sessionState.isHost) {
      Promise.resolve(renderPromise).then(() => {
        broadcastPages();
        broadcastPageChange(pagesState.activePageId);
      });
    }
  }

  function removePage(id, { fromSync = false } = {}) {
    if (!id) return;
    if (!sessionState.isHost && !fromSync) {
      if (pages.length <= 1) return;
      requestPageRemove(id);
      return;
    }
    if (pages.length <= 1) return;
    finalizeActiveImageIfPresent();
    const index = findPageIndex(id);
    if (index === -1) return;
    if (sessionState.isHost && pages[index].id === pagesState.activePageId) {
      saveCurrentPageState();
    }
    const wasActive = pages[index].id === pagesState.activePageId;
    pages.splice(index, 1);
    if (!pages.length) {
      const fallback = createPage({
        bg: uiState.currentBackground,
        bgPattern: uiState.currentBackgroundPattern,
        bgColor: uiState.currentBackgroundColor
      });
      pages.push(fallback);
      pagesState.activePageId = fallback.id;
    } else if (wasActive) {
      const next = pages[index] ?? pages[index - 1] ?? pages[0];
      pagesState.activePageId = next.id;
    }
    const renderPromise = applyPageToCanvas(getActivePage());
    renderPageThumbnails();
    if (sessionState.isHost) {
      Promise.resolve(renderPromise).then(() => {
        broadcastPages();
        broadcastPageChange(pagesState.activePageId);
      });
    }
  }

  function stepPage(delta) {
    if (!pages.length) return;
    const index = findPageIndex(pagesState.activePageId);
    if (index === -1) return;
    const nextIndex = Math.min(pages.length - 1, Math.max(0, index + delta));
    if (nextIndex === index) return;
    setActivePage(pages[nextIndex].id);
  }

  function resetPages({ bg = uiState.currentBackground, image = null, preserveCanvas = false } = {}) {
    pagesState.pageOrderCounter = 0;
    pages.length = 0;
    const initial = createPage({ bg, image });
    pages.push(initial);
    pagesState.activePageId = initial.id;
    if (!preserveCanvas) {
      clearCanvas();
      applyBackgroundColor(
        {
          style: initial.bg,
          pattern: initial.bgPattern,
          color: initial.bgColor
        },
        false
      );
      if (initial.image) {
        applySnapshot(initial.image);
      }
    }
    renderPageThumbnails();
    resetHistory();
  }

  function applyImportedPdfPages(images, { background = '#ffffff' } = {}) {
    if (!Array.isArray(images) || images.length === 0) return;
    const bg = typeof background === 'string' ? background : '#ffffff';
    pagesState.pageOrderCounter = 0;
    pages.length = 0;
    images.forEach(img => {
      const page = createPage({ bg, image: img });
      pages.push(page);
    });
    pagesState.activePageId = pages[0]?.id ?? null;
    const activePage = getActivePage();
    if (activePage) {
      applyPageToCanvas(activePage);
    } else {
      clearCanvas();
      applyBackgroundColor({ style: bg }, false);
    }
    renderPageThumbnails();
    applyBackgroundColor({ style: bg });
    if (sessionState.isHost) {
      broadcastPages();
      broadcastPageChange(pagesState.activePageId);
    }
    resetHistory();
  }

  async function renderPdfPageToImage(
    page,
    targetWidth,
    targetHeight,
    background = '#ffffff'
  ) {
    if (!page) return null;
    const safeWidth = Math.max(1, Math.round(targetWidth));
    const safeHeight = Math.max(1, Math.round(targetHeight));
    let viewport = page.getViewport({ scale: 1 });
    let scale = Math.min(
      safeWidth / (viewport.width || safeWidth),
      safeHeight / (viewport.height || safeHeight)
    );
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    viewport = page.getViewport({ scale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.max(1, Math.round(viewport.width));
    renderCanvas.height = Math.max(1, Math.round(viewport.height));
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    if (!renderCtx) {
      throw new Error('No se ha podido preparar el lienzo para el PDF.');
    }
    renderCtx.fillStyle = '#ffffff';
    renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
    await page.render({ canvasContext: renderCtx, viewport }).promise;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = safeWidth;
    outputCanvas.height = safeHeight;
    const outputCtx = outputCanvas.getContext('2d', { alpha: false });
    if (!outputCtx) {
      throw new Error('No se ha podido inicializar el lienzo de salida.');
    }
    outputCtx.fillStyle = typeof background === 'string' ? background : '#ffffff';
    outputCtx.fillRect(0, 0, safeWidth, safeHeight);
    const dx = Math.floor((safeWidth - renderCanvas.width) / 2);
    const dy = Math.floor((safeHeight - renderCanvas.height) / 2);
    outputCtx.drawImage(
      renderCanvas,
      dx,
      dy,
      renderCanvas.width,
      renderCanvas.height
    );
    return outputCanvas.toDataURL('image/png');
  }

  async function loadPdfFromFile(file) {
    if (!file) return;
    if (!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function') {
      throw new Error('No se ha podido cargar el visor de PDF.');
    }
    expandCanvasToViewport(true);
    syncCanvasResolution({ preserve: true });
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const fallbackWidth = Math.round(
      (canvas.clientWidth || board.clientWidth || 1280) * dpr
    );
    const fallbackHeight = Math.round(
      (canvas.clientHeight ||
        board.clientHeight ||
        desiredCanvasHeight()) * dpr
    );
    const targetWidth = Math.max(1, canvas.width || fallbackWidth);
    const targetHeight = Math.max(1, canvas.height || fallbackHeight);
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    let pdf = null;
    try {
      pdf = await loadingTask.promise;
      if (!pdf || !pdf.numPages) {
        throw new Error('El PDF no contiene páginas.');
      }
      const images = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const dataUrl = await renderPdfPageToImage(
          page,
          targetWidth,
          targetHeight
        );
        if (dataUrl) images.push(dataUrl);
        if (typeof page.cleanup === 'function') page.cleanup();
      }
      if (!images.length) {
        throw new Error('No se pudieron procesar las páginas del PDF.');
      }
      applyImportedPdfPages(images, { background: '#ffffff' });
    } finally {
      try {
        if (
          loadingTask &&
          typeof loadingTask.destroy === 'function'
        ) {
          await loadingTask.destroy();
        }
      } catch (e) {
        // ignore
      }
      if (pdf && typeof pdf.cleanup === 'function') {
        try {
          pdf.cleanup();
        } catch (e) {
          // ignore
        }
      }
    }
  }

  function syncPagesFromHost(list, activeId) {
    if (!Array.isArray(list) || list.length === 0) {
      pagesState.pageOrderCounter = 0;
      pages.length = 0;
      const fallback = createPage({
        bg: uiState.currentBackground,
        bgPattern: uiState.currentBackgroundPattern,
        bgColor: uiState.currentBackgroundColor
      });
      pages.push(fallback);
      pagesState.activePageId = fallback.id;
      applyPageToCanvas(fallback);
      renderPageThumbnails();
      return;
    }
    pagesState.pageOrderCounter = 0;
    pages.length = 0;
    list.forEach(item => {
      const page = createPage({
        id: item.id || generatePageId(),
        bg: item.bg,
        bgPattern: item.bgPattern,
        bgColor: item.bgColor,
        bgImage: item.bgImage,
        bgSize: item.bgSize,
        image: item.image || null,
        order: item.order ?? null
      });
      pages.push(page);
    });
    pagesState.activePageId =
      activeId && pages.find(p => p.id === activeId)
        ? activeId
        : pages[0]?.id ?? null;
    applyPageToCanvas(getActivePage());
    renderPageThumbnails();
  }

  function exportPagesAsPdf() {
    if (!window.jspdf) {
      alert('No se ha podido cargar jsPDF.');
      return;
    }
    if (!pages.length) {
      alert('No hay páginas para exportar.');
      return;
    }
    const snapshots = pages.map(page => ({
      id: page.id,
      bg: {
        style: page.bg,
        color: page.bgColor,
        pattern: page.bgPattern
      },
      data: snapshotForPage(page)
    }));
    const { jsPDF } = window.jspdf;
    const w =
      canvas.clientWidth || board.clientWidth || canvas.width || 1280;
    const h =
      canvas.clientHeight || board.clientHeight || canvas.height || 720;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
    snapshots.forEach((snap, index) => {
      const dataUrl =
        snap.data ||
        blankPageDataUrl({
          style: snap.bg?.style ?? '#ffffff',
          color: snap.bg?.color,
          pattern: snap.bg?.pattern
        });
      if (index > 0) {
        pdf.addPage([w, h], orientation);
      }
      pdf.addImage(dataUrl, 'PNG', 0, 0, w, h);
    });
    pdf.save(`pizarra-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  function handleThumbnailClick(e) {
    const deleteBtn = e.target.closest('.page-thumb-delete');
    if (deleteBtn) {
      const id = deleteBtn.dataset.pageId;
      if (id) removePage(id);
      return;
    }
    const thumb = e.target.closest('.page-thumb');
    if (thumb) {
      const id = thumb.dataset.pageId;
      if (id) setActivePage(id);
    }
  }

  function bindDomEvents() {
    pagePanelHead?.addEventListener('pointerdown', startPagePanelDrag);
    document.addEventListener('pointermove', updatePagePanelDrag);
    document.addEventListener('pointerup', endPagePanelDrag);
    document.addEventListener('pointercancel', endPagePanelDrag);

    pageToggleBtn?.addEventListener('click', () => {
      setPagePanelOpen(!pagesState.pagePanelOpen);
    });

    pageCloseBtn?.addEventListener('click', () => {
      setPagePanelOpen(false);
    });

    pageAddBtn?.addEventListener('click', () => addNewPage());
    pagePrevBtn?.addEventListener('click', () => stepPage(-1));
    pageNextBtn?.addEventListener('click', () => stepPage(1));

    pageThumbnailsEl?.addEventListener('click', handleThumbnailClick);

    if (pdfInput) {
      pdfInput.addEventListener('change', async event => {
        const input = event.target;
        const file =
          input?.files && input.files[0] ? input.files[0] : null;
        if (!file) {
          if (input) input.value = '';
          return;
        }
        if (!sessionState.isHost) {
          alert('Solo el anfitrión puede cargar PDFs.');
          input.value = '';
          return;
        }
        if (!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function') {
          alert('No se ha podido cargar el visor de PDF.');
          input.value = '';
          return;
        }
        if (openPdfBtn) {
          openPdfBtn.setAttribute('disabled', 'true');
          openPdfBtn.setAttribute('aria-busy', 'true');
        }
        try {
          await loadPdfFromFile(file);
        } catch (err) {
          console.error(err);
          const message =
            err?.message || 'No se pudo abrir el PDF seleccionado.';
          alert(message);
        } finally {
          if (openPdfBtn) {
            openPdfBtn.removeAttribute('disabled');
            openPdfBtn.removeAttribute('aria-busy');
          }
          input.value = '';
        }
      });
    }

    openPdfBtn?.addEventListener('click', () => {
      if (!sessionState.isHost) {
        alert('Solo el anfitrión puede cargar PDFs.');
        return;
      }
      pdfInput?.click();
    });

    savePdfBtn?.addEventListener('click', () => {
      exportPagesAsPdf();
    });
  }

  function initialize() {
    applyPagePanelPosition();
    bindDomEvents();
    resetPages({ bg: uiState.currentBackground, preserveCanvas: true });
    resetHistory();
  }

  initialize();

  window.addEventListener('fullscreenchange', handleFullscreenChange);
  window.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  window.addEventListener('mozfullscreenchange', handleFullscreenChange);
  window.addEventListener('MSFullscreenChange', handleFullscreenChange);
  handleFullscreenChange();

  return {
    pages,
    getActivePage,
    createPage,
    setActivePage,
    addNewPage,
    removePage,
    stepPage,
    resetPages,
    applyImportedPdfPages,
    renderPageThumbnails,
    saveCurrentPageState,
    schedulePageSnapshot,
    serializePages,
    snapshotForPage,
    ensurePagePanelWithinViewport,
    setPagePanelOpen,
    syncPagesFromHost,
    broadcastPages,
    broadcastPageChange,
    loadPdfFromFile,
    enterBoardFullscreen,
    exitBoardFullscreen
  };
}
