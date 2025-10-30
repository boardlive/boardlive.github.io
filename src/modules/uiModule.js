import { listBackgroundPresets, resolveBackgroundSetting } from '../config/backgrounds.js';
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
  const backgroundPresets = listBackgroundPresets();
  const backgroundPresetById = new Map(
    backgroundPresets.map(preset => [preset.id, preset])
  );

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
    backgroundPreset: bgPresetInput,
    code: codeInput,
    guestAllowAll: guestAllowAllInput,
    guestSelfName: guestSelfNameInput,
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
    boardRestore: boardRestoreBtn,
    insertImage: insertImageBtn,
    openImage: openImageBtn,
    statusToggle,
    guestPanelClose,
    guestRequest: guestRequestBtn
  } = buttons;

  const {
    role: roleLabel
  } = labels;

  const { toolbarControls, guestPanel, guestHostView, guestSelfView } = panels;

  const {
    overlay: qrOverlay,
    codeText: qrCodeText,
    url: qrUrl,
    copyFeedback: copyUrlFeedback
  } = qrDom;

  const {
    codeWrapper,
    statusText,
    guestList,
    guestEmpty,
    guestPanelTitle,
    guestRequestHint
  } = misc;

  const {
    setToolSettingsPane = noop,
    setToolSettingsOpen = noop,
    forceCloseToolSettings = noop,
    updateToolSettingsUi = noop,
    setEraserMode = noop,
    updateEraserLabel = noop,
    ensureToolSettingsWithinViewport = noop
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
    buttons.clear,
    buttons.undo,
    buttons.redo,
    buttons.pageToggle,
    buttons.pageAdd,
    buttons.pagePrev,
    buttons.pageNext,
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
  const initialBackground = resolveBackgroundSetting({
    style: uiState.currentBackground,
    pattern: uiState.currentBackgroundPattern,
    color: uiState.currentBackgroundColor
  });
  uiState.currentBackground = initialBackground.style;
  uiState.currentBackgroundColor = initialBackground.color;
  uiState.currentBackgroundPattern = initialBackground.pattern;
  uiState.currentBackgroundImage = initialBackground.image;
  uiState.currentBackgroundSize = initialBackground.size;
  if (bgInput && bgInput.value !== initialBackground.color) {
    bgInput.value = initialBackground.color;
  }
  uiState.boardExpanded ??= false;
  uiState.restoreToolSettingsOnExpand ??= false;
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
    cleanupPeer: noop,
    setGuestAccessMode: noop,
    setGuestCanDraw: noop,
    sendGuestName: noop,
    setGuestRequestState: noop
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
    networkApiRef.setGuestAccessMode =
      typeof api.setGuestAccessMode === 'function'
        ? api.setGuestAccessMode
        : noop;
    networkApiRef.setGuestCanDraw =
      typeof api.setGuestCanDraw === 'function'
        ? api.setGuestCanDraw
        : noop;
    networkApiRef.sendGuestName =
      typeof api.sendGuestName === 'function' ? api.sendGuestName : noop;
    networkApiRef.setGuestRequestState =
      typeof api.setGuestRequestState === 'function'
        ? api.setGuestRequestState
        : noop;
  }

  let guestRosterState = {
    total: 0,
    guests: [],
    mode: 'host-only',
    guestLock: true
  };
  let suppressGuestControlsSync = false;

  function setStatus(text, state = 'disconnected') {
    const normalizedText =
      typeof text === 'string' && text.toLowerCase() === 'esperando conexiones'
        ? 'Esperando conexiones'
        : text;
    if (statusText) statusText.textContent = normalizedText;
    if (statusToggle) {
      const actionLabel = `${normalizedText} - Ver conexiones`;
      statusToggle.setAttribute('aria-label', actionLabel);
      statusToggle.title = actionLabel;
    }
    if (statusEl) statusEl.dataset.state = state;
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

  function backgroundChangesDisabled() {
    return (
      !sessionState.isHost &&
      !!(sessionState.conn && sessionState.conn.open)
    );
  }

  function presetSupportsColor(id) {
    return !!backgroundPresetById.get(id)?.supportsColor;
  }

  function populateBackgroundPresetOptions() {
    if (!bgPresetInput) return;
    if (bgPresetInput.options.length > 0) return;
    backgroundPresets.forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      bgPresetInput.appendChild(option);
    });
  }

  function updateBackgroundControls() {
    const disable = backgroundChangesDisabled();
    if (bgPresetInput) {
      populateBackgroundPresetOptions();
      const pattern = uiState.currentBackgroundPattern || 'solid';
      if (bgPresetInput.value !== pattern) {
        bgPresetInput.value = pattern;
      }
      bgPresetInput.disabled = disable;
    }
    if (bgInput) {
      const supportsColor = presetSupportsColor(
        uiState.currentBackgroundPattern || 'solid'
      );
      const colorValue = uiState.currentBackgroundColor || '#ffffff';
      if (colorValue && bgInput.value !== colorValue) {
        bgInput.value = colorValue;
      }
      bgInput.disabled = disable || !supportsColor;
    }
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
    board?.classList.toggle('guest-view', !sessionState.isHost);
    if (roleLabel) {
      roleLabel.textContent = sessionState.isHost
        ? 'Modo anfitrión:'
        : 'Modo invitado:';
    }
    const shouldHidePagePanel =
      !sessionState.isHost &&
      (!guestConnected || sessionState.remoteLock);
    if (shouldHidePagePanel) setPagePanelOpen(false);
    if (
      !sessionState.isHost &&
      (!guestConnected || sessionState.remoteLock) &&
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
      window.setTimeout(() => hideQr(), 600);
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

  function updateGuestPanelView() {
    if (!guestPanel) return;
    const isHost = sessionState.isHost;
    if (guestPanelTitle) {
      guestPanelTitle.textContent = isHost
        ? 'Invitados conectados'
        : 'Mi conexión';
    }
    if (guestHostView) guestHostView.hidden = !isHost;
    if (guestSelfView) guestSelfView.hidden = isHost;
  }

  function renderGuestRoster() {
    updateGuestPanelView();
    if (!sessionState.isHost) {
      if (guestHostView) guestHostView.hidden = true;
      if (statusEl) delete statusEl.dataset.alert;
      return;
    }
    if (!guestList) return;

    const list = Array.isArray(guestRosterState.guests)
      ? guestRosterState.guests
      : [];
    const mode = guestRosterState.mode || 'host-only';
    const allowAll = mode === 'all';
    const hasRequests = list.some(guest => guest.requesting);
    const orderedList = list
      .slice()
      .sort((a, b) => {
        if (!!a.requesting === !!b.requesting) {
          return a.index - b.index;
        }
        return a.requesting ? -1 : 1;
      });

    if (statusEl) {
      if (hasRequests) statusEl.dataset.alert = 'true';
      else delete statusEl.dataset.alert;
    }

    if (guestEmpty) {
      guestEmpty.hidden = list.length !== 0;
    }

    if (guestAllowAllInput) {
      suppressGuestControlsSync = true;
      guestAllowAllInput.checked = allowAll;
      guestAllowAllInput.disabled = !sessionState.isHost;
      suppressGuestControlsSync = false;
    }

    guestList.innerHTML = '';

    const fragment = document.createDocumentFragment();
    orderedList.forEach(guest => {
      const row = document.createElement('div');
      row.className = 'guest-row';
      row.dataset.guestId = guest.id;
      row.dataset.index = guest.index;
      if (!guest.canDraw) {
        row.classList.add('guest-row-locked');
      }
      if (guest.requesting) {
        row.classList.add('guest-row-request');
      }

      const title = document.createElement('div');
      title.className = 'guest-row-title';
      title.textContent = guest.displayName || guest.defaultName;
      row.appendChild(title);

      if (guest.requesting) {
        const badge = document.createElement('span');
        badge.className = 'guest-request-badge';
        badge.textContent = 'Solicitud de edición';
        row.appendChild(badge);
      }

      const controls = document.createElement('div');
      controls.className = 'guest-row-controls';

      const permissionLabel = document.createElement('label');
      permissionLabel.className = 'guest-permission-toggle';
      const permissionInput = document.createElement('input');
      permissionInput.type = 'checkbox';
      permissionInput.className = 'guest-can-draw';
      permissionInput.dataset.guestId = guest.id;
      permissionInput.checked = !!guest.canDraw;
      permissionInput.disabled = allowAll;
      permissionInput.setAttribute(
        'aria-label',
        guest.canDraw
          ? `Desactivar permisos de dibujo para ${guest.defaultName}`
          : `Permitir dibujar a ${guest.defaultName}`
      );
      if (!allowAll) {
        permissionInput.addEventListener('change', handleGuestPermissionChange);
      }
      permissionLabel.appendChild(permissionInput);
      const permissionText = document.createElement('span');
      permissionText.textContent = guest.canDraw
        ? 'Puede dibujar'
        : 'Solo lectura';
      permissionLabel.appendChild(permissionText);
      controls.appendChild(permissionLabel);

      row.appendChild(controls);
      fragment.appendChild(row);
    });

    guestList.appendChild(fragment);
  }

  function renderGuestSelfPanel() {
    updateGuestPanelView();
    if (sessionState.isHost) return;

    const connected = !!(sessionState.conn && sessionState.conn.open);
    const canDraw = !sessionState.remoteLock && connected;
    const requesting = !!sessionState.guestRequestPending && !canDraw;

    if (guestSelfView) guestSelfView.hidden = false;
    if (guestHostView) guestHostView.hidden = true;
    if (statusEl) delete statusEl.dataset.alert;

    if (guestSelfNameInput) {
      const target = sessionState.guestName || '';
      if (guestSelfNameInput.value !== target) {
        guestSelfNameInput.value = target;
      }
    }

    if (guestRequestBtn) {
      guestRequestBtn.classList.toggle('pending', requesting);
      guestRequestBtn.classList.toggle('granted', canDraw);
      if (!connected) {
        guestRequestBtn.disabled = true;
        guestRequestBtn.textContent = 'Conéctate para solicitar edición';
      } else if (canDraw) {
        guestRequestBtn.disabled = true;
        guestRequestBtn.textContent = 'Ya puedes dibujar';
      } else {
        guestRequestBtn.disabled = false;
        guestRequestBtn.textContent = requesting
          ? 'Cancelar solicitud'
          : 'Pedir permiso para dibujar';
      }
    }

    if (guestRequestHint) {
      if (!connected) {
        guestRequestHint.textContent = 'No estás conectado a ninguna pizarra.';
      } else if (canDraw) {
        guestRequestHint.textContent = 'Ya tienes permiso para editar la pizarra.';
      } else if (requesting) {
        guestRequestHint.textContent = 'Solicitud enviada. Espera a que el anfitrión la acepte.';
      } else {
        guestRequestHint.textContent = 'Actualmente estás en modo lectura.';
      }
    }
  }

  function updateGuestRoster(snapshot = {}) {
    guestRosterState = {
      total: Number.isFinite(snapshot.total) ? snapshot.total : 0,
      guests: Array.isArray(snapshot.guests) ? snapshot.guests : [],
      mode: snapshot.mode || 'host-only',
      guestLock: typeof snapshot.guestLock === 'boolean'
        ? snapshot.guestLock
        : guestRosterState.guestLock
    };
    renderGuestRoster();
    if (!sessionState.isHost) {
      renderGuestSelfPanel();
    }
  }

  function openGuestPanel() {
    if (!guestPanel) return;
    updateGuestPanelView();
    guestPanel.hidden = false;
    guestPanel.dataset.open = 'true';
    statusToggle?.setAttribute('aria-expanded', 'true');
    uiState.guestPanelOpen = true;
    if (sessionState.isHost && guestAllowAllInput && !guestAllowAllInput.disabled) {
      guestAllowAllInput.focus();
    } else if (guestPanel) {
      const focusable = guestPanel.querySelector(
        'input:not([disabled]), button:not([disabled])'
      );
      focusable?.focus();
    }
  }

  function closeGuestPanel() {
    if (!guestPanel) return;
    if (guestPanel.hidden) return;
    guestPanel.hidden = true;
    delete guestPanel.dataset.open;
    statusToggle?.setAttribute('aria-expanded', 'false');
    uiState.guestPanelOpen = false;
  }

  function toggleGuestPanel(force) {
    const shouldOpen =
      typeof force === 'boolean'
        ? force
        : Boolean(guestPanel?.hidden);
    if (shouldOpen) openGuestPanel();
    else closeGuestPanel();
  }

  function handleGuestPanelOutsideClick(event) {
    if (!uiState.guestPanelOpen) return;
    if (!guestPanel) return;
    if (guestPanel.contains(event.target)) return;
    if (statusToggle && statusToggle.contains(event.target)) return;
    closeGuestPanel();
  }

  function handleGuestAllowAllChange(event) {
    if (suppressGuestControlsSync) return;
    if (!sessionState.isHost) {
      renderGuestRoster();
      return;
    }
    const checked = !!event.target.checked;
    networkApiRef.setGuestAccessMode(checked ? 'all' : 'host-only');
  }

  function handleGuestPermissionChange(event) {
    if (!sessionState.isHost) return;
    const input = event.target;
    if (!input || !input.dataset.guestId) return;
    networkApiRef.setGuestCanDraw(input.dataset.guestId, input.checked);
  }

  function handleGuestSelfNameInput(event) {
    if (sessionState.isHost) return;
    const value = event?.target?.value ?? '';
    networkApiRef.sendGuestName(value);
  }

  function handleGuestRequestToggle() {
    if (sessionState.isHost) return;
    const connected = !!(sessionState.conn && sessionState.conn.open);
    if (!connected) return;
    const canDraw = !sessionState.remoteLock;
    if (canDraw) return;
    networkApiRef.setGuestRequestState(!sessionState.guestRequestPending);
  }

  function refreshUi() {
    renderGuestRoster();
    if (!sessionState.isHost) {
      renderGuestSelfPanel();
    }
    updateGuestControls();
    updateBackgroundControls();
    updateEraserLabel();
    updateCodeInputVisibility();
    if (!sessionState.isHost) {
      if (sessionState.conn && sessionState.conn.open) {
        const locked = sessionState.remoteLock;
        setStatus(
          locked ? 'Pulsa para pedir permiso' : 'Conectado',
          locked ? 'locked' : 'connected'
        );
      } else {
        setStatus('Sin conexión', 'disconnected');
      }
    } else {
      const count = guests.size;
      if (count > 0) {
        setStatus(`Invitados conectados: ${count}`, 'connected');
      } else {
        setStatus('Esperando invitados', 'connected');
      }
    }
    updateRoleUi();
    updateToolSettingsUi();
    adjustGuestView();
    updateShareLinkUi();
  }

  function applyBackground(background, propagate = true) {
    applyBackgroundColor(background, propagate);
  }

  function onBackgroundApplied(background, propagate = true) {
    const resolved = resolveBackgroundSetting(
      typeof background === 'object' && background !== null
        ? background
        : {
            style:
              typeof background === 'string'
                ? background
                : uiState.currentBackground,
            pattern: uiState.currentBackgroundPattern,
            color: uiState.currentBackgroundColor
          }
    );
    uiState.currentBackground = resolved.style;
    uiState.currentBackgroundColor = resolved.color;
    uiState.currentBackgroundPattern = resolved.pattern;
    uiState.currentBackgroundImage = resolved.image;
    uiState.currentBackgroundSize = resolved.size;
    if (bgPresetInput) {
      populateBackgroundPresetOptions();
      if (bgPresetInput.value !== resolved.pattern) {
        bgPresetInput.value = resolved.pattern;
      }
    }
    if (bgInput) {
      if (bgInput.value !== resolved.color) {
        bgInput.value = resolved.color;
      }
    }
    updateBackgroundControls();
  }

  function handleBackgroundInput(event) {
    const value = event?.target?.value;
    if (!sessionState.isHost) {
      if (event?.target) {
        event.target.value = uiState.currentBackgroundColor || '#ffffff';
      }
      return;
    }
    if (typeof value !== 'string' || !value) return;
    applyBackground({ pattern: 'solid', color: value });
  }

  function handleBackgroundPresetChange(event) {
    const selected = event?.target?.value;
    if (!sessionState.isHost) {
      if (bgPresetInput) {
        bgPresetInput.value = uiState.currentBackgroundPattern || 'solid';
      }
      return;
    }
    const preset =
      backgroundPresetById.get(selected) ||
      backgroundPresetById.get('solid');
    if (!preset) return;
    const baseColor = preset.baseColor || '#ffffff';
    const color = preset.supportsColor
      ? bgInput?.value || uiState.currentBackgroundColor || baseColor
      : baseColor;
    applyBackground({ pattern: preset.id, color });
  }

  function handleViewToggle() {
    if (uiState.boardExpanded) {
      exitBoardFullscreen();
    } else {
      uiState.restoreToolSettingsOnExpand = !!toolsState.toolSettingsOpen;
      enterBoardFullscreen();
    }
  }

  function handleBoardFullscreenChange({ active } = {}) {
    if (active) {
      if (
        uiState.restoreToolSettingsOnExpand &&
        !toolsState.toolSettingsOpen
      ) {
        setToolSettingsOpen(true, { force: true });
      }
      if (toolsState.toolSettingsOpen) {
        ensureToolSettingsWithinViewport();
      }
      uiState.restoreToolSettingsOnExpand = false;
    } else {
      uiState.restoreToolSettingsOnExpand = false;
      if (toolsState.toolSettingsOpen) {
        ensureToolSettingsWithinViewport();
      }
    }
    if (boardRestoreBtn) {
      if (active) boardRestoreBtn.removeAttribute('hidden');
      else boardRestoreBtn.setAttribute('hidden', '');
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
      closeGuestPanel();
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

  function extractClipboardImage(event) {
    const clipboard = event?.clipboardData;
    if (!clipboard) return null;

    const files = clipboard.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
          return file;
        }
      }
    }

    const items = clipboard.items;
    if (!items) return null;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (
        item &&
        item.kind === 'file' &&
        typeof item.type === 'string' &&
        item.type.startsWith('image/')
      ) {
        const file = item.getAsFile?.();
        if (file) return file;
      }
    }
    return null;
  }

  function handlePaste(event) {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable)
    ) {
      return;
    }
    if (!sessionState.isHost) {
      return;
    }

    const imageFile = extractClipboardImage(event);
    if (!imageFile) return;

    event.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      placeImageOnCanvas(reader.result);
    };
    reader.onerror = () => {
      alert('No se pudo pegar la imagen desde el portapapeles.');
    };
    reader.readAsDataURL(imageFile);
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
    boardRestoreBtn?.addEventListener('click', handleViewToggle);

    statusToggle?.addEventListener('click', () => {
      toggleGuestPanel();
    });
    guestPanelClose?.addEventListener('click', () => closeGuestPanel());
    guestAllowAllInput?.addEventListener('change', handleGuestAllowAllChange);
    document.addEventListener('click', handleGuestPanelOutsideClick);
    guestSelfNameInput?.addEventListener('input', handleGuestSelfNameInput);
    guestRequestBtn?.addEventListener('click', handleGuestRequestToggle);

    if (bgInput) {
      bgInput.addEventListener('input', handleBackgroundInput);
    }
    if (bgPresetInput) {
      bgPresetInput.addEventListener('change', handleBackgroundPresetChange);
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
    document.addEventListener('paste', handlePaste);

    [insertImageBtn, openImageBtn]
      .filter(Boolean)
      .forEach(btn => btn.addEventListener('click', handleInsertImage));
    imageInput?.addEventListener('change', handleImageInput);
  }

  function initialize() {
    statusToggle?.setAttribute('aria-expanded', 'false');
    populateBackgroundPresetOptions();
    updateGuestPanelView();
    closeGuestPanel();
    applyHostButtonState(sessionState.hostButtonState);
    applyJoinButtonState(sessionState.joinButtonState);
    setActiveSection(uiState.activeSection, { force: true });
    ensureActiveSectionVisible();
    applyMenuState();
    updateViewToggle();
    updateShareLinkUi();
    renderGuestRoster();
    if (!sessionState.isHost) {
      renderGuestSelfPanel();
    }
    refreshUi();
    applyBackground(
      {
        style: uiState.currentBackground,
        pattern: uiState.currentBackgroundPattern,
        color: uiState.currentBackgroundColor
      },
      false
    );
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
    handleBoardFullscreenChange,
    onBackgroundApplied,
    applyBackground,
    registerNetworkApi,
    updateGuestRoster
  };
}
