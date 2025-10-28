import { sanitizeCode } from '../utils/helpers.js';

const noop = () => {};

export function initUiModule({
  appState,
  domRefs,
  toolsApi = {},
  canvasApi = {},
  pagesApi = {}
}) {
  if (!appState) {
    throw new Error('initUiModule requires appState');
  }
  if (!domRefs) {
    throw new Error('initUiModule requires domRefs');
  }

  const sessionState = appState.session;
  const canvasState = appState.canvas;
  const toolsState = appState.tools;
  const uiState = appState.ui;
  const imagesState = appState.images;
  const guests = sessionState.guests;

  const {
    status: statusEl,
    header: headerEl,
    toolbarNav,
    menuQuery,
    toolButtons = [],
    hostOnlyEls = [],
    editOnlyEls = [],
    sectionButtons = [],
    toolbarSections = [],
    toolSettingsPanel,
    inputs = {},
    buttons = {},
    labels = {},
    panels = {},
    qr: qrDom = {},
    misc = {}
  } = domRefs;

  const {
    color: colorInput,
    size: sizeInput,
    eraserSize: eraserSizeInput,
    fill: fillInput,
    background: bgInput,
    code: codeInput,
    lockGuests: lockToggle,
    imageFile: imageInput
  } = inputs;

  const {
    host: hostBtn,
    join: joinBtn,
    copyUrl: copyUrlBtn,
    qrToggle: qrBtn,
    qrClose: qrCloseBtn,
    viewToggle: viewToggleBtn,
    menuToggle: menuToggleBtn,
    undo: undoBtn,
    redo: redoBtn,
    insertImage: insertImageBtn
  } = buttons;

  const {
    role: roleLabel
  } = labels;

  const { toolbarControls } = panels;

  const {
    overlay: qrOverlay,
    codeText: qrCodeText,
    url: qrUrl,
    copyFeedback: copyUrlFeedback
  } = qrDom;

  const { codeWrapper } = misc;

  const {
    setToolSettingsPane = noop,
    setToolSettingsOpen = noop,
    forceCloseToolSettings = noop,
    updateToolSettingsUi = noop,
    setEraserMode = noop,
    updateEraserLabel = noop
  } = toolsApi;

  const {
    expandCanvasToViewport = noop,
    adjustGuestView = noop,
    applyBackgroundColor = noop,
    performUndo = noop,
    performRedo = noop,
    placeImageOnCanvas = noop
  } = canvasApi;

  const {
    setPagePanelOpen = noop,
    enterBoardFullscreen = noop,
    exitBoardFullscreen = noop
  } = pagesApi;

  const guestControls = [
    colorInput,
    sizeInput,
    fillInput,
    buttons.eraser,
    eraserSizeInput,
    ...toolButtons
  ].filter(Boolean);

  const sectionsMap = new Map(
    (toolbarSections || []).map(section => [
      section.dataset.section,
      section
    ])
  );

  uiState.activeSection =
    toolbarControls?.dataset.active ||
    uiState.activeSection ||
    'session';
  uiState.copyFeedbackTimeout ??= null;
  uiState.qrInstance ??= null;
  sessionState.shareUrl ??= '';
  if (bgInput) {
    uiState.currentBackground =
      bgInput.value || uiState.currentBackground || '#ffffff';
  }
  uiState.boardExpanded ??= false;
  canvasState.historyActionStarted ??= false;
  toolsState.currentTool ??= 'pen';
  canvasState.shapeStart ??= null;
  canvasState.shapeSnapshot ??= null;
  canvasState.drawingShape ??= false;
  imagesState.activeImageOverlay ??= null;
  imagesState.activeImageState ??= null;
  imagesState.imageDragState ??= null;
  imagesState.imageResizeState ??= null;
  canvasState.activePointerId ??= null;

  if (statusEl && !statusEl.dataset.state) {
    statusEl.dataset.state = 'disconnected';
  }

  const networkApiRef = {
    broadcast: noop,
    startHost: noop,
    startGuest: noop,
    cleanupPeer: noop
  };

  function registerNetworkApi(api = {}) {
    networkApiRef.broadcast =
      typeof api.broadcast === 'function' ? api.broadcast : noop;
    networkApiRef.startHost =
      typeof api.startHost === 'function' ? api.startHost : noop;
    networkApiRef.startGuest =
      typeof api.startGuest === 'function' ? api.startGuest : noop;
    networkApiRef.cleanupPeer =
      typeof api.cleanupPeer === 'function' ? api.cleanupPeer : noop;
  }

  function setStatus(text, state = 'disconnected') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.state = state;
  }

  function updateCodeInputVisibility() {
    if (!codeWrapper) return;
    const hostActive =
      sessionState.isHost &&
      (sessionState.hostButtonState === 'pending' ||
        sessionState.hostButtonState === 'active');
    const guestConnected =
      !sessionState.isHost &&
      !!(sessionState.conn && sessionState.conn.open);
    const hide = hostActive || guestConnected;
    codeWrapper.classList.toggle('hidden', hide);
  }

  const hostButtonConfig = {
    idle: { label: '🖥️ Compartir mi pizarra' },
    pending: {
      label: '🖥️ Creando conexión…',
      ariaBusy: true,
      disabled: true
    },
    active: {
      label: '🖥️ Compartiendo pizarra',
      title: 'Pulsa para dejar de compartir'
    },
    error: { label: '🖥️ Reintentar compartir' }
  };

  function applyHostButtonState(state = 'idle') {
    sessionState.hostButtonState = state;
    const cfg = hostButtonConfig[state] || hostButtonConfig.idle;
    if (hostBtn) {
      hostBtn.dataset.state = state;
      hostBtn.textContent = cfg.label;
      if (cfg.title) hostBtn.title = cfg.title;
      else hostBtn.removeAttribute('title');
      if (cfg.disabled) hostBtn.setAttribute('disabled', '');
      else hostBtn.removeAttribute('disabled');
      if (cfg.ariaBusy) hostBtn.setAttribute('aria-busy', 'true');
      else hostBtn.removeAttribute('aria-busy');
    }
    updateCodeInputVisibility();
  }

  const joinButtonConfig = {
    idle: { label: '👥 Unirme a una pizarra' },
    pending: {
      label: '👥 Conectando con el anfitrión…',
      ariaBusy: true,
      disabled: true
    },
    active: {
      label: '👥 Conectado a la pizarra',
      title: 'Pulsa para desconectar'
    },
    error: { label: '👥 Reintentar conexión' }
  };

  function applyJoinButtonState(state = 'idle') {
    if (!joinBtn) return;
    sessionState.joinButtonState = state;
    const cfg = joinButtonConfig[state] || joinButtonConfig.idle;
    joinBtn.dataset.state = state;
    joinBtn.textContent = cfg.label;
    if (cfg.title) joinBtn.title = cfg.title;
    else joinBtn.removeAttribute('title');
    if (cfg.disabled) joinBtn.setAttribute('disabled', '');
    else joinBtn.removeAttribute('disabled');
    if (cfg.ariaBusy) joinBtn.setAttribute('aria-busy', 'true');
    else joinBtn.removeAttribute('aria-busy');
  }

  function updateLockToggle() {
    if (!lockToggle) return;
    lockToggle.disabled = !sessionState.isHost;
    lockToggle.checked = sessionState.isHost
      ? sessionState.guestLock
      : sessionState.remoteLock;
    lockToggle.title = sessionState.isHost
      ? 'Impide que los invitados dibujen o borren la pizarra'
      : 'Solo el anfitrión puede cambiar esta opción';
  }

  function updateGuestControls() {
    const disable =
      !sessionState.isHost && sessionState.remoteLock;
    guestControls.forEach(el => {
      if (el) el.disabled = disable;
    });
    if (disable) {
      canvasState.drawing = false;
      if (canvasState.erasing) setEraserMode(false);
      forceCloseToolSettings();
    }
  }

  function updateBackgroundInput() {
    if (!bgInput) return;
    const disable =
      !sessionState.isHost &&
      !!(sessionState.conn && sessionState.conn.open);
    bgInput.disabled = disable;
    if (disable) bgInput.value = uiState.currentBackground;
  }

  function toggleHidden(elements, hidden) {
    elements.forEach(el => {
      if (!el) return;
      el.classList.toggle('hidden', hidden);
      if (hidden && el === toolSettingsPanel) {
        forceCloseToolSettings();
      }
      if (
        hidden &&
        typeof el.contains === 'function' &&
        el.contains(document.activeElement)
      ) {
        try {
          document.activeElement.blur();
        } catch (err) {
          console.warn(err);
        }
      }
    });
  }

  function sectionHasVisibleContent(section) {
    if (!section) return false;
    return Array.from(section.children).some(child => {
      if (!(child instanceof HTMLElement)) return false;
      if (child.classList.contains('hidden')) return false;
      return true;
    });
  }

  function refreshSectionButtons() {
    sectionButtons.forEach(btn => {
      if (!btn) return;
      const id = btn.dataset.target;
      const section = sectionsMap.get(id);
      const visible = sectionHasVisibleContent(section);
      btn.classList.toggle('hidden', !visible);
      const isActive = visible && id === uiState.activeSection;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    toolbarSections.forEach(section => {
      if (!section) return;
      const id = section.dataset.section;
      const isActive = id === uiState.activeSection;
      const hasContent = sectionHasVisibleContent(section);
      section.setAttribute(
        'aria-hidden',
        isActive && hasContent ? 'false' : 'true'
      );
    });
  }

  function setActiveSection(id, { force = false } = {}) {
    if (!toolbarControls || !sectionsMap.has(id)) return;
    if (!force && id === uiState.activeSection) {
      refreshSectionButtons();
      return;
    }
    uiState.activeSection = id;
    toolbarControls.dataset.active = id;
    refreshSectionButtons();
    if (id !== 'draw') {
      if (!toolsState.toolSettingsPinned) {
        setToolSettingsOpen(false);
      }
    } else if (!toolsState.toolSettingsOpen) {
      setToolSettingsOpen(true);
    }
  }

  function ensureActiveSectionVisible() {
    const current = sectionsMap.get(uiState.activeSection);
    if (sectionHasVisibleContent(current)) return;
    const fallback = sectionButtons.find(
      btn => !btn.classList.contains('hidden')
    );
    if (fallback) {
      setActiveSection(fallback.dataset.target, { force: true });
    }
  }

  function currentMenuCollapsed() {
    if (uiState.manualMenuState !== null) {
      return uiState.manualMenuState;
    }
    return !!menuQuery?.matches;
  }

  function applyMenuState() {
    const collapsed = currentMenuCollapsed();
    if (headerEl) {
      headerEl.dataset.collapsed = collapsed ? 'true' : 'false';
    }
    if (menuToggleBtn) {
      menuToggleBtn.setAttribute(
        'aria-expanded',
        collapsed ? 'false' : 'true'
      );
      menuToggleBtn.setAttribute(
        'aria-label',
        collapsed
          ? 'Mostrar menú de herramientas'
          : 'Ocultar menú de herramientas'
      );
      menuToggleBtn.textContent = collapsed
        ? 'Mostrar menú'
        : 'Ocultar menú';
    }
    if (toolbarControls) {
      toolbarControls.setAttribute(
        'aria-hidden',
        collapsed ? 'true' : 'false'
      );
      if (collapsed) toolbarControls.setAttribute('inert', '');
      else toolbarControls.removeAttribute('inert');
    }
    if (toolbarNav) {
      toolbarNav.setAttribute(
        'aria-hidden',
        collapsed ? 'true' : 'false'
      );
      if (collapsed) toolbarNav.setAttribute('inert', '');
      else toolbarNav.removeAttribute('inert');
    }
    expandCanvasToViewport(sessionState.isHost);
    adjustGuestView();
  }

  function updateViewToggle() {
    if (!viewToggleBtn) return;
    const expanded = !!uiState.boardExpanded;
    viewToggleBtn.dataset.active = expanded ? 'true' : 'false';
    viewToggleBtn.setAttribute(
      'aria-pressed',
      expanded ? 'true' : 'false'
    );
    viewToggleBtn.textContent = expanded ? '↺ Salir' : '⛶ Maximizar';
    viewToggleBtn.title = expanded
      ? 'Salir de pantalla completa'
      : 'Maximizar área de dibujo';
  }

  function updateRoleUi() {
    const guestConnected =
      !sessionState.isHost &&
      !!(sessionState.conn && sessionState.conn.open);
    toggleHidden(hostOnlyEls, guestConnected);
    const hideEdit =
      guestConnected && sessionState.remoteLock;
    toggleHidden(editOnlyEls, hideEdit);
    if (joinBtn) {
      const hideJoin = sessionState.isHost;
      joinBtn.classList.toggle('hidden', hideJoin);
    }
    if (headerEl) {
      headerEl.dataset.role = sessionState.isHost
        ? 'host'
        : 'guest';
    }
    if (roleLabel) {
      roleLabel.textContent = sessionState.isHost
        ? 'Modo anfitrión:'
        : 'Modo invitado:';
    }
    if (!sessionState.isHost) setPagePanelOpen(false);
    if (
      !sessionState.isHost &&
      toolsState.toolSettingsPane === 'page'
    ) {
      setToolSettingsPane('tool');
    }
    refreshSectionButtons();
    ensureActiveSectionVisible();
  }

  function updateShareLinkUi() {
    if (qrUrl) {
      const available = !!sessionState.shareUrl;
      qrUrl.textContent = available ? sessionState.shareUrl : '—';
      qrUrl.title = available
        ? 'Haz clic para copiar'
        : 'Enlace no disponible';
      qrUrl.classList.toggle('disabled', !available);
      if (available) qrUrl.setAttribute('tabindex', '0');
      else qrUrl.setAttribute('tabindex', '-1');
      qrUrl.setAttribute(
        'aria-disabled',
        available ? 'false' : 'true'
      );
    }
    if (copyUrlBtn) {
      copyUrlBtn.disabled = !sessionState.shareUrl;
    }
    if (!sessionState.shareUrl) {
      hideCopyFeedback();
    }
  }

  function hideCopyFeedback() {
    if (uiState.copyFeedbackTimeout) {
      clearTimeout(uiState.copyFeedbackTimeout);
      uiState.copyFeedbackTimeout = null;
    }
    if (!copyUrlFeedback) return;
    copyUrlFeedback.classList.add('hidden');
    copyUrlFeedback.classList.remove('error');
  }

  function showCopyFeedback(message, { error = false } = {}) {
    if (!copyUrlFeedback) return;
    hideCopyFeedback();
    copyUrlFeedback.textContent = message;
    copyUrlFeedback.classList.toggle('error', !!error);
    copyUrlFeedback.classList.remove('hidden');
    uiState.copyFeedbackTimeout = window.setTimeout(
      () => hideCopyFeedback(),
      error ? 2400 : 1600
    );
  }

  async function copyShareLink() {
    if (!sessionState.shareUrl) {
      showCopyFeedback('No hay enlace disponible', {
        error: true
      });
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          sessionState.shareUrl
        );
      } else {
        const temp = document.createElement('textarea');
        temp.value = sessionState.shareUrl;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(temp);
        if (!ok) throw new Error('Clipboard copy failed');
      }
      showCopyFeedback('Enlace copiado');
    } catch (err) {
      console.error(err);
      showCopyFeedback('No se pudo copiar', { error: true });
    }
  }

  function ensureQr() {
    if (!uiState.qrInstance) {
      uiState.qrInstance = new QRCode(
        document.getElementById('qr'),
        {
          width: 240,
          height: 240,
          correctLevel: QRCode.CorrectLevel.M
        }
      );
    }
    return uiState.qrInstance;
  }

  function showQr() {
    if (!sessionState.shareUrl) {
      alert(
        'Activa el modo anfitrión para obtener un código y enlace de conexión.'
      );
      return;
    }
    if (!qrOverlay || !qrUrl) {
      console.warn(
        'No se pudo mostrar el QR porque falta el contenedor del enlace.'
      );
      return;
    }
    ensureQr().makeCode(sessionState.shareUrl);
    updateShareLinkUi();
    hideCopyFeedback();
    if (qrCodeText) {
      qrCodeText.textContent =
        sanitizeCode(codeInput?.value) || '—';
    }
    qrOverlay.style.display = 'flex';
    window.setTimeout(() => {
      if (
        qrOverlay?.style.display === 'flex' &&
        qrUrl &&
        !qrUrl.classList.contains('disabled')
      ) {
        qrUrl.focus();
      }
    }, 60);
  }

  function hideQr() {
    if (qrOverlay) qrOverlay.style.display = 'none';
    hideCopyFeedback();
  }

  function refreshUi() {
    updateLockToggle();
    updateGuestControls();
    updateBackgroundInput();
    updateEraserLabel();
    updateCodeInputVisibility();
    if (!sessionState.isHost) {
      if (sessionState.conn && sessionState.conn.open) {
        const locked = sessionState.remoteLock;
        setStatus(
          locked ? 'Sin edición' : 'conectado',
          'connected'
        );
      } else {
        setStatus('sin conexión', 'disconnected');
      }
    } else {
      const count = guests.size;
      if (count > 0) {
        setStatus(`conectados: ${count}`, 'connected');
      } else {
        setStatus('esperando conexiones', 'connected');
      }
    }
    updateRoleUi();
    updateToolSettingsUi();
    adjustGuestView();
    updateShareLinkUi();
  }

  function emitBg(color) {
    if (!sessionState.isHost) return;
    networkApiRef.broadcast({ type: 'bg', color });
  }

  function applyBackground(color, propagate = true) {
    applyBackgroundColor(color, propagate);
  }

  function onBackgroundApplied(color, propagate = true) {
    const target =
      typeof color === 'string'
        ? color
        : uiState.currentBackground;
    if (bgInput) {
      bgInput.value = target;
    }
    if (propagate) emitBg(target);
  }

  function handleBackgroundInput(event) {
    const value = event?.target?.value;
    if (!sessionState.isHost) {
      if (event?.target) {
        event.target.value = uiState.currentBackground;
      }
      return;
    }
    applyBackground(value);
  }

  function handleLockToggle() {
    if (!sessionState.isHost) {
      if (lockToggle) {
        lockToggle.checked = sessionState.remoteLock;
      }
      return;
    }
    sessionState.guestLock = !!lockToggle?.checked;
    refreshUi();
    networkApiRef.broadcast({
      type: 'lock',
      value: sessionState.guestLock
    });
  }

  function handleViewToggle() {
    if (uiState.boardExpanded) {
      exitBoardFullscreen();
    } else {
      enterBoardFullscreen();
    }
  }

  function sanitizeCodeInput() {
    if (!codeInput) return;
    codeInput.value = sanitizeCode(codeInput.value);
  }

  function handleHostButton(event) {
    if (event && event.isTrusted === false) return;
    if (sessionState.hostButtonState === 'pending') return;
    if (sessionState.hostButtonState === 'active') {
      networkApiRef.cleanupPeer();
      return;
    }
    sessionState.allowHostStart = true;
    try {
      networkApiRef.startHost();
    } finally {
      sessionState.allowHostStart = false;
    }
  }

  function handleJoinButton(event) {
    if (event && event.isTrusted === false) return;
    if (sessionState.joinButtonState === 'pending') return;
    if (sessionState.joinButtonState === 'active') {
      networkApiRef.cleanupPeer();
      return;
    }
    networkApiRef.startGuest();
  }

  function handleUndoButton() {
    if (undoBtn?.disabled) return;
    performUndo();
  }

  function handleRedoButton() {
    if (redoBtn?.disabled) return;
    performRedo();
  }

  function handleKeyboardShortcuts(event) {
    if (event.defaultPrevented) return;
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable)
    ) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key?.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) performRedo();
        else performUndo();
      } else if (key === 'y') {
        event.preventDefault();
        performRedo();
      }
    }
    if (event.key === 'Escape') {
      hideQr();
    }
  }

  function handleImageInput(event) {
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
  }

  function handleInsertImage() {
    if (!sessionState.isHost) {
      alert('Solo el anfitrión puede insertar imágenes.');
      return;
    }
    imageInput?.click();
  }

  function bindDomListeners() {
    sectionButtons.forEach(btn => {
      btn?.addEventListener('click', () => {
        if (btn.classList.contains('hidden')) return;
        setActiveSection(btn.dataset.target, { force: true });
      });
    });

    menuToggleBtn?.addEventListener('click', () => {
      const collapsed = headerEl?.dataset.collapsed === 'true';
      uiState.manualMenuState = collapsed ? false : true;
      applyMenuState();
    });

    if (typeof menuQuery?.addEventListener === 'function') {
      menuQuery.addEventListener('change', e => {
        if (e && !e.matches) {
          uiState.manualMenuState = null;
        }
        applyMenuState();
      });
    } else if (typeof menuQuery?.addListener === 'function') {
      menuQuery.addListener(e => {
        if (e && !e.matches) {
          uiState.manualMenuState = null;
        }
        applyMenuState();
      });
    }

    qrBtn?.addEventListener('click', showQr);
    qrCloseBtn?.addEventListener('click', hideQr);
    qrOverlay?.addEventListener('click', e => {
      if (e.target === qrOverlay) hideQr();
    });

    copyUrlBtn?.addEventListener('click', copyShareLink);
    qrUrl?.addEventListener('click', () => {
      if (qrUrl.classList.contains('disabled')) return;
      copyShareLink();
    });
    qrUrl?.addEventListener('keydown', e => {
      if (
        e.key !== 'Enter' &&
        e.key !== ' ' &&
        e.key !== 'Spacebar'
      )
        return;
      e.preventDefault();
      if (qrUrl.classList.contains('disabled')) return;
      copyShareLink();
    });

    viewToggleBtn?.addEventListener('click', handleViewToggle);
    lockToggle?.addEventListener('change', handleLockToggle);

    if (bgInput) {
      bgInput.addEventListener('input', handleBackgroundInput);
    }

    if (codeInput) {
      codeInput.addEventListener('input', sanitizeCodeInput);
      codeInput.addEventListener('change', sanitizeCodeInput);
    }

    hostBtn?.addEventListener('click', handleHostButton);
    joinBtn?.addEventListener('click', handleJoinButton);

    undoBtn?.addEventListener('click', handleUndoButton);
    redoBtn?.addEventListener('click', handleRedoButton);
    document.addEventListener('keydown', handleKeyboardShortcuts);

    insertImageBtn?.addEventListener('click', handleInsertImage);
    imageInput?.addEventListener('change', handleImageInput);
  }

  function initialize() {
    applyHostButtonState(sessionState.hostButtonState);
    applyJoinButtonState(sessionState.joinButtonState);
    setActiveSection(uiState.activeSection, { force: true });
    ensureActiveSectionVisible();
    applyMenuState();
    updateViewToggle();
    updateShareLinkUi();
    refreshUi();
    applyBackground(uiState.currentBackground, false);
  }

  bindDomListeners();
  initialize();

  return {
    setStatus,
    refreshUi,
    applyHostButtonState,
    applyJoinButtonState,
    updateShareLinkUi,
    hideQr,
    updateViewToggle,
    onBackgroundApplied,
    applyBackground,
    registerNetworkApi
  };
}
