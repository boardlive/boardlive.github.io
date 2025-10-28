import {
  TOOL_DEFAULTS,
  TOOL_UI_COPY,
  PAGE_UI_COPY,
  TOOL_SETTINGS_MARGIN
} from '../config/constants.js';
import { sanitizeHexColor, highlightColor, clamp } from '../utils/helpers.js';

const toolSettings = new Map(
  Object.entries(TOOL_DEFAULTS).map(([tool, cfg]) => {
    const settings = { ...cfg };
    if (tool === 'rect' || tool === 'ellipse') {
      settings.fillTransparent = true;
    }
    return [tool, settings];
  })
);

const DEFAULT_ERASER_SIZE = 20;
let eraserSize = DEFAULT_ERASER_SIZE;

function ensureToolSettings(tool) {
  const key = TOOL_DEFAULTS[tool] ? tool : 'pen';
  if (!toolSettings.has(key)) {
    const base = { ...(TOOL_DEFAULTS[key] || TOOL_DEFAULTS.pen) };
    if (key === 'rect' || key === 'ellipse') {
      base.fillTransparent = true;
    }
    toolSettings.set(key, base);
  }
  const settings = toolSettings.get(key);
  if (
    (key === 'rect' || key === 'ellipse') &&
    typeof settings.fillTransparent !== 'boolean'
  ) {
    settings.fillTransparent = true;
  }
  return settings;
}

function rawToolFillColor(tool) {
  const defaults = TOOL_DEFAULTS[tool] || {};
  const settings = ensureToolSettings(tool);
  return sanitizeHexColor(
    settings.fill ?? defaults.fill ?? '#ffffff',
    defaults.fill ?? '#ffffff'
  );
}

function isToolFillTransparent(tool) {
  if (tool !== 'rect' && tool !== 'ellipse') return false;
  const settings = ensureToolSettings(tool);
  return !!settings.fillTransparent;
}

function setToolFillTransparent(tool, value) {
  if (tool !== 'rect' && tool !== 'ellipse') return false;
  const settings = ensureToolSettings(tool);
  settings.fillTransparent = !!value;
  return settings.fillTransparent;
}

export function isShapeTool(tool) {
  return tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

export function toolDisplayLabel(tool) {
  const copy = TOOL_UI_COPY[tool] || TOOL_UI_COPY.pen;
  const icon = copy.icon ? `${copy.icon} ` : '';
  return `${icon}${copy.title || 'Herramienta'}`;
}

export function rawToolStrokeColor(tool) {
  const defaults = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.pen;
  const settings = ensureToolSettings(tool);
  return sanitizeHexColor(settings.stroke, defaults.stroke);
}

export function toolStrokeColor(tool) {
  if (tool === 'eraser') return '#000000';
  const base = rawToolStrokeColor(tool);
  if (tool === 'highlight') return highlightColor(base);
  return base;
}

export function toolFillColor(tool) {
  if (tool !== 'rect' && tool !== 'ellipse') return '#ffffff';
  if (isToolFillTransparent(tool)) return null;
  return rawToolFillColor(tool);
}

function sanitizeToolSize(tool, value) {
  const defaults = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.pen;
  const raw = Number(value);
  const fallback = Number(defaults.size) || 4;
  const safe = Number.isFinite(raw) ? raw : fallback;
  return clamp(Math.round(safe), 1, 100);
}

export function getToolSize(tool) {
  const settings = ensureToolSettings(tool);
  return sanitizeToolSize(tool, settings.size);
}

export function setToolSize(tool, value) {
  const settings = ensureToolSettings(tool);
  settings.size = sanitizeToolSize(tool, value);
  return settings.size;
}

export function setToolStrokeColor(tool, value) {
  const defaults = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.pen;
  const settings = ensureToolSettings(tool);
  settings.stroke = sanitizeHexColor(value, defaults.stroke);
  return settings.stroke;
}

export function setToolFillColor(tool, value) {
  if (tool !== 'rect' && tool !== 'ellipse') return null;
  const defaults = TOOL_DEFAULTS[tool] || {};
  const settings = ensureToolSettings(tool);
  settings.fillTransparent = false;
  settings.fill = sanitizeHexColor(value, defaults.fill ?? '#ffffff');
  return settings.fill;
}

export function getEraserSize() {
  return eraserSize;
}

export function setEraserSize(value) {
  eraserSize = clamp(
    Math.round(Number(value) || DEFAULT_ERASER_SIZE),
    1,
    100
  );
  return eraserSize;
}

export function initToolsModule({ appState, domRefs }) {
  if (!appState || !domRefs) {
    throw new Error('initToolsModule requires appState and domRefs');
  }

  const sessionState = appState.session;
  const canvasState = appState.canvas;
  const toolsState = appState.tools;
  const uiState = appState.ui ?? {};

  const {
    canvas,
    header: headerEl,
    toolButtons,
    toolSettingsPanel,
    inputs = {},
    buttons = {},
    labels = {},
    panels = {},
    misc = {}
  } = domRefs;

  const toolButtonsList = Array.isArray(toolButtons)
    ? toolButtons
    : Array.from(toolButtons ?? []);

  const {
    color: colorInput,
    size: sizeInput,
    fill: fillInput,
    fillTransparent: fillTransparentInput,
    eraserSize: eraserSizeInput
  } = inputs;

  const {
    eraser: eraserBtn,
    toolSettingsToggle,
    toolSettingsClose,
    toolSettingsPin,
    toolSettingsReset
  } = buttons;

  const {
    stroke: strokeLabelEl,
    size: sizeLabelEl,
    fill: fillLabelEl
  } = labels;

  const {
    toolSettingsToolPane,
    toolSettingsPagePane,
    strokeSetting,
    sizeSetting,
    eraserSetting,
    fillSetting,
    toolSettingsTitle,
    toolSettingsHint,
    pageTab: pageTabBtn,
    toolSettingsHead
  } = panels;

  const { eraserCursor: eraserCursorEl } = misc;

  const toolSettingsPosition = toolsState.toolSettingsPosition;
  const toolSettingsDrag = toolsState.toolSettingsDrag;

  let headerResizeObserver = null;

  function updateToolTriggerLabel() {
    if (!toolSettingsToggle) return;
    if (canvasState.erasing) {
      toolSettingsToggle.textContent = '🧽 Borrador';
      toolSettingsToggle.title = 'Ajustar el borrador';
      return;
    }
    const label = toolDisplayLabel(toolsState.currentTool);
    toolSettingsToggle.textContent = label;
    toolSettingsToggle.title = `Seleccionar herramienta (${label})`;
  }

  function updateToolSettingsPinUi() {
    if (!toolSettingsPin) return;
    const pinned = !!toolsState.toolSettingsPinned;
    const label = pinned
      ? 'Desfijar panel de herramientas'
      : 'Fijar panel de herramientas';
    toolSettingsPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    toolSettingsPin.setAttribute('aria-label', label);
    toolSettingsPin.title = label;
    toolSettingsPin.textContent = pinned ? '📍' : '📌';
  }

  function captureToolSettingsPosition() {
    if (!toolSettingsPanel) return;
    const rect = toolSettingsPanel.getBoundingClientRect();
    toolSettingsPosition.left = rect.left;
    toolSettingsPosition.top = rect.top;
  }

  function applyToolSettingsPosition() {
    if (!toolSettingsPanel) return;
    if (
      Number.isFinite(toolSettingsPosition.left) &&
      Number.isFinite(toolSettingsPosition.top)
    ) {
      toolSettingsPanel.style.left = `${Math.round(toolSettingsPosition.left)}px`;
      toolSettingsPanel.style.top = `${Math.round(toolSettingsPosition.top)}px`;
      toolSettingsPanel.style.right = 'auto';
      toolSettingsPanel.style.bottom = 'auto';
    }
  }

  function resetToolSettingsPosition() {
    toolsState.toolSettingsHasCustomPosition = false;
    toolSettingsPosition.left = null;
    toolSettingsPosition.top = null;
  }

  function ensureToolSettingsWithinViewport() {
    if (!toolSettingsPanel) return;
    if (
      !toolsState.toolSettingsHasCustomPosition &&
      !toolsState.toolSettingsPinned
    ) {
      return;
    }
    const rect = toolSettingsPanel.getBoundingClientRect();
    const margin = TOOL_SETTINGS_MARGIN;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    let left = rect.left;
    let top = rect.top;
    let adjusted = false;
    if (left < margin) {
      left = margin;
      adjusted = true;
    } else if (left > maxLeft) {
      left = maxLeft;
      adjusted = true;
    }
    if (top < margin) {
      top = margin;
      adjusted = true;
    } else if (top > maxTop) {
      top = maxTop;
      adjusted = true;
    }
    if (adjusted) {
      toolSettingsPosition.left = left;
      toolSettingsPosition.top = top;
      applyToolSettingsPosition();
    }
  }

  function setToolSettingsPinned(pinned) {
    const next = !!pinned;
    if (next === !!toolsState.toolSettingsPinned) return;
    toolsState.toolSettingsPinned = next;
    if (toolSettingsPanel) {
      toolSettingsPanel.dataset.pinned = next ? 'true' : 'false';
    }
    updateToolSettingsPinUi();
    if (next) {
      if (!toolsState.toolSettingsOpen) {
        setToolSettingsOpen(true, { force: true });
      }
      captureToolSettingsPosition();
      toolsState.toolSettingsHasCustomPosition = true;
      ensureToolSettingsWithinViewport();
      applyToolSettingsPosition();
    } else {
      resetToolSettingsPosition();
      positionToolSettings();
    }
  }

  function forceCloseToolSettings({ resetPin = false } = {}) {
    if (resetPin && toolsState.toolSettingsPinned) {
      setToolSettingsPinned(false);
    }
    setToolSettingsOpen(false, { force: true });
  }

  function setToolSettingsDragging(active) {
    if (!toolSettingsPanel) return;
    if (active) {
      toolSettingsPanel.dataset.dragging = 'true';
    } else {
      delete toolSettingsPanel.dataset.dragging;
    }
  }

  function startToolSettingsDrag(e) {
    if (!toolSettingsPanel) return;
    const isPrimary = e.button === undefined || e.button === 0;
    if (!isPrimary) return;
    if (e.target && e.target.closest('button')) return;
    const rect = toolSettingsPanel.getBoundingClientRect();
    toolSettingsDrag.active = true;
    toolSettingsDrag.pointerId = e.pointerId ?? 'mouse';
    toolSettingsDrag.offsetX = e.clientX - rect.left;
    toolSettingsDrag.offsetY = e.clientY - rect.top;
    toolSettingsDrag.width = rect.width;
    toolSettingsDrag.height = rect.height;
    toolsState.toolSettingsHasCustomPosition = true;
    toolSettingsPosition.left = rect.left;
    toolSettingsPosition.top = rect.top;
    applyToolSettingsPosition();
    setToolSettingsDragging(true);
    if (toolSettingsPanel.setPointerCapture && e.pointerId !== undefined) {
      try {
        toolSettingsPanel.setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    e.preventDefault();
  }

  function moveToolSettingsDrag(e) {
    if (!toolSettingsDrag.active) return;
    if (
      toolSettingsDrag.pointerId !== 'mouse' &&
      e.pointerId !== undefined &&
      e.pointerId !== toolSettingsDrag.pointerId
    ) {
      return;
    }
    const width =
      toolSettingsDrag.width || (toolSettingsPanel?.offsetWidth ?? 0);
    const height =
      toolSettingsDrag.height || (toolSettingsPanel?.offsetHeight ?? 0);
    const margin = TOOL_SETTINGS_MARGIN;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const baseLeft = e.clientX - toolSettingsDrag.offsetX;
    const baseTop = e.clientY - toolSettingsDrag.offsetY;
    toolSettingsPosition.left = clamp(baseLeft, margin, maxLeft);
    toolSettingsPosition.top = clamp(baseTop, margin, maxTop);
    applyToolSettingsPosition();
    e.preventDefault();
  }

  function endToolSettingsDrag(e) {
    if (!toolSettingsDrag.active) return;
    if (
      toolSettingsDrag.pointerId !== 'mouse' &&
      e.pointerId !== undefined &&
      e.pointerId !== toolSettingsDrag.pointerId
    ) {
      return;
    }
    toolSettingsDrag.active = false;
    toolSettingsDrag.pointerId = null;
    toolSettingsDrag.offsetX = 0;
    toolSettingsDrag.offsetY = 0;
    toolSettingsDrag.width = 0;
    toolSettingsDrag.height = 0;
    ensureToolSettingsWithinViewport();
    if (toolSettingsPanel?.releasePointerCapture && e.pointerId !== undefined) {
      try {
        toolSettingsPanel.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    captureToolSettingsPosition();
    setToolSettingsDragging(false);
    e.preventDefault();
  }

  function toggleToolSetting(el, show) {
    if (!el) return;
    const visible = !!show;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
    const field = el.querySelector('input, select, textarea');
    if (field) {
      field.disabled = !visible;
    }
  }

  function updateToolSettingsUi() {
    const tool = canvasState.erasing ? 'eraser' : toolsState.currentTool;
    const copy = TOOL_UI_COPY[tool] || TOOL_UI_COPY.pen;
    if (toolsState.toolSettingsPane === 'tool') {
      if (toolSettingsTitle) {
        toolSettingsTitle.textContent = copy.title || 'Herramienta';
      }
      if (toolSettingsHint) {
        toolSettingsHint.textContent =
          copy.hint || 'Ajusta las propiedades de la herramienta seleccionada.';
      }
    }
    const showStroke = tool !== 'eraser';
    const showSize = tool !== 'eraser';
    const showFill = !!copy.showFill && tool !== 'eraser';

    toggleToolSetting(strokeSetting, showStroke);
    toggleToolSetting(sizeSetting, showSize);
    toggleToolSetting(eraserSetting, tool === 'eraser');

    if (showStroke && strokeLabelEl) {
      strokeLabelEl.textContent = copy.stroke || 'Color';
    }
    if (showSize && sizeLabelEl) {
      sizeLabelEl.textContent = copy.size || 'Grosor (px)';
    }

    if (showStroke && colorInput) {
      colorInput.value = rawToolStrokeColor(tool);
    }
    if (showSize && sizeInput) {
      sizeInput.value = String(getToolSize(tool));
    }

    if (fillSetting) {
      toggleToolSetting(fillSetting, showFill);
      if (showFill) {
        if (fillLabelEl) fillLabelEl.textContent = copy.fill || 'Relleno';
        const transparent = isToolFillTransparent(tool);
        if (fillTransparentInput) {
          fillTransparentInput.checked = transparent;
          fillTransparentInput.disabled = false;
        }
        if (fillInput) {
          fillInput.disabled = transparent;
          fillInput.value = rawToolFillColor(tool);
        }
      } else if (fillTransparentInput) {
        fillTransparentInput.checked = false;
        fillTransparentInput.disabled = true;
      }
    }

    if (tool === 'eraser' && eraserSizeInput) {
      eraserSizeInput.value = String(getEraserSize());
    }
  }

  function positionToolSettings() {
    if (!toolSettingsPanel) return;
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    if (mobile) {
      toolSettingsPanel.style.removeProperty('top');
      toolSettingsPanel.style.removeProperty('left');
      toolSettingsPanel.style.removeProperty('right');
      toolSettingsPanel.style.removeProperty('bottom');
      if (!toolsState.toolSettingsPinned) {
        resetToolSettingsPosition();
      }
      return;
    }
    if (
      (toolsState.toolSettingsPinned || toolsState.toolSettingsHasCustomPosition) &&
      Number.isFinite(toolSettingsPosition.left) &&
      Number.isFinite(toolSettingsPosition.top)
    ) {
      applyToolSettingsPosition();
      ensureToolSettingsWithinViewport();
      return;
    }
    const headerRect = headerEl?.getBoundingClientRect();
    const top = headerRect ? Math.max(8, Math.round(headerRect.bottom + 12)) : 90;
    toolSettingsPanel.style.top = `${top}px`;
    toolSettingsPanel.style.removeProperty('bottom');
    toolSettingsPanel.style.removeProperty('left');
    toolSettingsPanel.style.right = '16px';
  }

  function updateToolSelection() {
    toolButtonsList.forEach(btn => {
      if (!btn) return;
      const tool = btn.dataset.tool;
      const isEraser = tool === 'eraser';
      const active = canvasState.erasing ? isEraser : toolsState.currentTool === tool;
      const selected = toolsState.toolSettingsPane === 'tool' && active;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.classList.toggle('active', active);
      const desiredLabel = toolDisplayLabel(tool);
      if (btn.textContent !== desiredLabel) {
        btn.textContent = desiredLabel;
      }
    });
    if (pageTabBtn) {
      pageTabBtn.setAttribute(
        'aria-selected',
        toolsState.toolSettingsPane === 'page' ? 'true' : 'false'
      );
    }
    updateToolTriggerLabel();
    updateCanvasCursor();
  }

  function setToolSettingsPane(pane) {
    const next = pane === 'page' ? 'page' : 'tool';
    toolsState.toolSettingsPane = next;
    if (toolSettingsToolPane) toolSettingsToolPane.hidden = next !== 'tool';
    if (toolSettingsPagePane) toolSettingsPagePane.hidden = next !== 'page';
    if (next === 'tool') {
      updateToolSettingsUi();
    } else {
      if (toolSettingsTitle) toolSettingsTitle.textContent = PAGE_UI_COPY.title;
      if (toolSettingsHint) toolSettingsHint.textContent = PAGE_UI_COPY.hint;
    }
    updateToolSelection();
  }

  function setToolSettingsOpen(open, { force = false } = {}) {
    const next = !!open;
    if (!next && toolsState.toolSettingsPinned && !force) {
      return;
    }
    if (next === !!toolsState.toolSettingsOpen) {
      if (next) positionToolSettings();
      return;
    }
    toolsState.toolSettingsOpen = next;
    if (toolSettingsPanel) {
      toolSettingsPanel.dataset.open = next ? 'true' : 'false';
      toolSettingsPanel.setAttribute('aria-hidden', next ? 'false' : 'true');
    }
    if (toolSettingsToggle) {
      toolSettingsToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    }
    if (next) {
      positionToolSettings();
      setToolSettingsPane(toolsState.toolSettingsPane);
    } else if (!toolsState.toolSettingsPinned) {
      resetToolSettingsPosition();
    }
  }

  function toggleToolSettings() {
    if (toolsState.toolSettingsOpen) {
      forceCloseToolSettings();
    } else {
      setToolSettingsOpen(true);
    }
  }

  function setCurrentTool(tool, { silent = false } = {}) {
    if (tool === 'eraser') {
      setEraserMode(true);
      setToolSettingsPane('tool');
      if (!silent) {
        setToolSettingsOpen(true);
      }
      return;
    }
    const allowed = ['pen', 'line', 'rect', 'ellipse', 'highlight'];
    const next = allowed.includes(tool) ? tool : 'pen';
    toolsState.currentTool = next;
    if (canvasState.erasing) {
      canvasState.erasing = false;
      updateEraserLabel();
    }
    setToolSettingsPane('tool');
    if (!silent) {
      setToolSettingsOpen(true);
    }
  }

  function effectiveTool() {
    if (canvasState.erasing) return 'eraser';
    return toolsState.currentTool;
  }

  function updateCanvasCursor() {
    if (!canvas) return;
    const tool = effectiveTool();
    let cursor = 'crosshair';
    if (tool === 'eraser') cursor = 'cell';
    canvas.style.cursor = cursor;
  }

  function pointerClientPosition(e) {
    if (!e) return null;
    const source = e.touches?.[0] || e.changedTouches?.[0] || e;
    const x = source?.clientX;
    const y = source?.clientY;
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  }

  function hideEraserCursor() {
    if (!eraserCursorEl) return;
    eraserCursorEl.style.left = '-1000px';
    eraserCursorEl.style.top = '-1000px';
  }

  function updateEraserCursorSize() {
    if (!eraserCursorEl || !canvasState.erasing) return;
    const scale = canvasState.canvasScale || 1;
    const diameter = Math.max(6, getEraserSize() * scale);
    eraserCursorEl.style.width = `${diameter}px`;
    eraserCursorEl.style.height = `${diameter}px`;
    const border = Math.max(1, Math.min(4, Math.round(diameter * 0.15)));
    eraserCursorEl.style.borderWidth = `${border}px`;
  }

  function updateEraserCursorFromEvent(e) {
    if (!eraserCursorEl) return;
    if (!canvasState.erasing) {
      hideEraserCursor();
      if (canvas) canvas.classList.remove('erase-mode');
      return;
    }
    const pos = pointerClientPosition(e);
    if (!pos) {
      hideEraserCursor();
      return;
    }
    updateEraserCursorSize();
    if (canvas) canvas.classList.add('erase-mode');
    eraserCursorEl.style.left = `${pos.x}px`;
    eraserCursorEl.style.top = `${pos.y}px`;
  }

  function updateEraserLabel() {
    if (eraserBtn) {
      eraserBtn.textContent = canvasState.erasing ? 'Borrador (on)' : 'Borrador';
    }
    if (canvas) {
      canvas.classList.toggle('erase-mode', canvasState.erasing);
    }
    if (canvasState.erasing) updateEraserCursorSize();
    else hideEraserCursor();
  }

  function setEraserMode(active) {
    const desired = !!active;
    if (desired === !!canvasState.erasing) {
      updateEraserLabel();
      if (desired && toolsState.toolSettingsPane !== 'tool') {
        setToolSettingsPane('tool');
      } else {
        updateToolSelection();
        if (toolsState.toolSettingsPane === 'tool') {
          updateToolSettingsUi();
        }
      }
      return;
    }
    canvasState.erasing = desired;
    updateEraserLabel();
    if (desired && toolsState.toolSettingsPane !== 'tool') {
      setToolSettingsPane('tool');
    } else {
      updateToolSelection();
      if (toolsState.toolSettingsPane === 'tool') {
        updateToolSettingsUi();
      }
    }
  }

  // Initial state setup
  toolsState.toolSettingsPane = toolsState.toolSettingsPane || 'tool';
  toolsState.toolSettingsOpen =
    !!toolsState.toolSettingsOpen && !!toolsState.toolSettingsPinned;
  if (toolSettingsPanel) {
    toolSettingsPanel.dataset.pinned = toolsState.toolSettingsPinned ? 'true' : 'false';
    toolSettingsPanel.setAttribute('aria-hidden', 'true');
  }
  updateToolSettingsPinUi();
  updateToolTriggerLabel();
  if (pageTabBtn) {
    const pageLabel = `${PAGE_UI_COPY.icon} ${PAGE_UI_COPY.title}`;
    if (pageTabBtn.textContent !== pageLabel) {
      pageTabBtn.textContent = pageLabel;
    }
  }
  setToolSettingsPane(toolsState.toolSettingsPane);
  setToolSettingsOpen(false, { force: true });
  updateEraserLabel();

  if (headerEl && typeof ResizeObserver === 'function') {
    headerResizeObserver = new ResizeObserver(() => {
      if (toolsState.toolSettingsOpen) positionToolSettings();
    });
    headerResizeObserver.observe(headerEl);
  }

  toolButtonsList.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setCurrentTool(btn.dataset.tool);
    });
  });

  if (pageTabBtn) {
    pageTabBtn.addEventListener('click', () => {
      if (pageTabBtn.disabled) return;
      setToolSettingsPane('page');
      if (toolsState.toolSettingsOpen) {
        const firstField = toolSettingsPagePane?.querySelector(
          'input,select,textarea,button'
        );
        if (firstField && typeof firstField.focus === 'function') {
          window.requestAnimationFrame(() => firstField.focus());
        }
      }
    });
  }

  toolSettingsToggle?.addEventListener('click', () => {
    toggleToolSettings();
  });

  toolSettingsClose?.addEventListener('click', () => {
    forceCloseToolSettings();
  });

  toolSettingsPin?.addEventListener('click', () => {
    setToolSettingsPinned(!toolsState.toolSettingsPinned);
  });

  if (toolSettingsHead) {
    toolSettingsHead.addEventListener('pointerdown', startToolSettingsDrag);
  }
  document.addEventListener('pointermove', moveToolSettingsDrag);
  document.addEventListener('pointerup', endToolSettingsDrag);
  document.addEventListener('pointercancel', endToolSettingsDrag);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && toolsState.toolSettingsOpen) {
      forceCloseToolSettings();
      toolSettingsToggle?.focus();
    }
  });

  document.addEventListener('pointerdown', e => {
    if (!toolsState.toolSettingsOpen) return;
    const target = e.target;
    if (
      toolSettingsPanel?.contains(target) ||
      toolSettingsToggle?.contains(target)
    ) {
      return;
    }
    if (toolsState.toolSettingsPinned) return;
    setToolSettingsOpen(false);
  });

  window.addEventListener('resize', () => {
    if (toolsState.toolSettingsOpen) positionToolSettings();
  });

  window.addEventListener(
    'scroll',
    () => {
      if (toolsState.toolSettingsOpen) positionToolSettings();
    },
    { passive: true }
  );

  colorInput?.addEventListener('input', () => {
    const color = setToolStrokeColor(toolsState.currentTool, colorInput.value);
    colorInput.value = color;
  });
  colorInput?.addEventListener('change', () => {
    const color = setToolStrokeColor(toolsState.currentTool, colorInput.value);
    colorInput.value = color;
  });

  sizeInput?.addEventListener('input', () => {
    if (sizeInput.value === '') return;
    setToolSize(toolsState.currentTool, sizeInput.value);
  });
  sizeInput?.addEventListener('change', () => {
    const size = setToolSize(toolsState.currentTool, sizeInput.value);
    sizeInput.value = String(size);
  });

  const handleFillChange = () => {
    if (!fillInput) return;
    if (toolsState.currentTool === 'rect' || toolsState.currentTool === 'ellipse') {
      setToolFillTransparent(toolsState.currentTool, false);
      if (fillTransparentInput) fillTransparentInput.checked = false;
      const color = setToolFillColor(toolsState.currentTool, fillInput.value);
      fillInput.value = color;
      fillInput.disabled = false;
      updateToolSettingsUi();
    }
  };
  fillInput?.addEventListener('input', handleFillChange);
  fillInput?.addEventListener('change', handleFillChange);

  fillTransparentInput?.addEventListener('change', () => {
    if (toolsState.currentTool !== 'rect' && toolsState.currentTool !== 'ellipse') {
      return;
    }
    const transparent = !!fillTransparentInput.checked;
    setToolFillTransparent(toolsState.currentTool, transparent);
    if (!transparent && fillInput) {
      const color = rawToolFillColor(toolsState.currentTool);
      setToolFillColor(toolsState.currentTool, color);
      fillInput.value = color;
    }
    updateToolSettingsUi();
  });

  eraserSizeInput?.addEventListener('change', () => {
    const size = setEraserSize(eraserSizeInput.value);
    eraserSizeInput.value = String(size);
    updateEraserCursorSize();
  });

  eraserBtn?.addEventListener('click', () => {
    if (eraserBtn.disabled) return;
    setCurrentTool('eraser');
  });

  if (eraserSizeInput) {
    const initialSize = setEraserSize(
      eraserSizeInput.value || getEraserSize()
    );
    eraserSizeInput.value = String(initialSize);
  }

  function resetToolPreferences() {
    toolSettings.clear();
    Object.entries(TOOL_DEFAULTS).forEach(([tool, cfg]) => {
      const settings = { ...cfg };
      if (tool === 'rect' || tool === 'ellipse') {
        settings.fillTransparent = true;
      }
      toolSettings.set(tool, settings);
    });
    eraserSize = DEFAULT_ERASER_SIZE;
    if (eraserSizeInput) {
      eraserSizeInput.value = String(eraserSize);
    }
    if (fillTransparentInput) {
      fillTransparentInput.checked = false;
      fillTransparentInput.disabled = false;
    }
    updateToolSettingsUi();
    updateToolSelection();
    updateToolTriggerLabel();
    updateEraserLabel();
  }

  toolSettingsReset?.addEventListener('click', () => {
    resetToolPreferences();
  });

  return {
    setCurrentTool,
    getCurrentTool: () => toolsState.currentTool,
    getEffectiveTool: effectiveTool,
    setEraserMode,
    isEraserActive: () => !!canvasState.erasing,
    updateCanvasCursor,
    updateEraserCursorFromEvent,
    updateEraserCursorSize,
    hideEraserCursor,
    updateEraserLabel,
    setToolSettingsPane,
    setToolSettingsOpen,
    toggleToolSettings,
    forceCloseToolSettings,
    positionToolSettings,
    ensureToolSettingsWithinViewport,
    captureToolSettingsPosition,
    applyToolSettingsPosition,
    resetToolSettingsPosition,
    updateToolSettingsUi,
    updateToolSelection,
    updateToolSettingsPinUi,
    updateToolTriggerLabel,
    setToolSettingsPinned,
    resetToolPreferences,
    disconnect: () => {
      if (headerResizeObserver) {
        try {
          headerResizeObserver.disconnect();
        } catch (err) {
          // ignore
        }
        headerResizeObserver = null;
      }
    }
  };
}
