const byId = (id) => document.getElementById(id);

/**
 * Collects and returns the DOM elements used across the app.
 * The structure groups related references for clarity.
 */
export function collectDomRefs() {
  const status = byId('status');
  const board = byId('board');
  const canvas = byId('canvas');
  const toolSettingsPanel = byId('toolSettingsPanel');
  const pagePanel = byId('pagePanel');

  return {
    status,
    board,
    canvas,
    header: document.querySelector('header'),
    toolbarNav: document.querySelector('.toolbar-nav'),
    menuQuery: window.matchMedia('(max-width: 900px)'),
    toolButtons: Array.from(
      document.querySelectorAll('.tool-settings-tabs .tool-btn[data-tool]')
    ),
    hostOnlyEls: Array.from(document.querySelectorAll('.host-only')),
    editOnlyEls: Array.from(document.querySelectorAll('.edit-only')),
    sectionButtons: Array.from(
      document.querySelectorAll('.toolbar-nav .tab-btn[data-target]')
    ),
    toolbarSections: Array.from(document.querySelectorAll('.toolbar-section')),
    toolSettingsPanel,
    pagePanel,
    inputs: {
      color: byId('color'),
      size: byId('size'),
      eraserSize: byId('eraserSize'),
      fill: byId('shapeFill'),
      fillTransparent: byId('shapeFillTransparent'),
      background: byId('bg'),
      backgroundPreset: byId('bgPreset'),
      code: byId('code'),
      guestAllowAll: byId('guestAllowAll'),
      guestSelfName: byId('guestSelfName'),
      pdfFile: byId('pdfInput'),
      imageFile: byId('imageInput')
    },
    buttons: {
      eraser: byId('eraser'),
      clear: byId('clear'),
      openImage: byId('openImage'),
      openPdf: byId('openPdf'),
      savePdf: byId('savePdf'),
      host: byId('hostBtn'),
      join: byId('joinBtn'),
      copyUrl: byId('copyUrlBtn'),
      qrToggle: byId('qrBtn'),
      qrClose: byId('qrClose'),
      viewToggle: byId('viewToggle'),
      menuToggle: byId('menuToggle'),
      undo: byId('undo'),
      redo: byId('redo'),
      boardRestore: byId('boardRestoreBtn'),
      insertImage: byId('insertImage'),
      pageAdd: byId('pageAdd'),
      pagePrev: byId('pagePrev'),
      pageNext: byId('pageNext'),
      pageToggle: byId('pageToggle'),
      pageClose: byId('pageClose'),
      toolSettingsToggle: byId('toolSettingsToggle'),
      toolSettingsClose: byId('toolSettingsClose'),
      toolSettingsPin: byId('toolSettingsPin'),
      toolSettingsReset: byId('toolSettingsReset'),
      statusToggle: byId('statusToggle'),
      guestPanelClose: byId('guestPanelClose'),
      guestRequest: byId('guestRequestBtn')
    },
    labels: {
      stroke: byId('strokeLabel'),
      size: byId('sizeLabel'),
      fill: byId('fillLabel'),
      role: byId('roleLabel')
    },
    panels: {
      pagePanel,
      guestPanel: byId('guestPanel'),
      guestHostView: byId('guestHostView'),
      guestSelfView: byId('guestSelfView'),
      toolbarControls: byId('toolbarControls'),
      toolSettingsToolPane:
        toolSettingsPanel?.querySelector('[data-pane="tool"]') ?? null,
      toolSettingsPagePane:
        toolSettingsPanel?.querySelector('[data-pane="page"]') ?? null,
      strokeSetting:
        toolSettingsPanel?.querySelector('[data-field="stroke"]') ?? null,
      sizeSetting:
        toolSettingsPanel?.querySelector('[data-field="size"]') ?? null,
      eraserSetting:
        toolSettingsPanel?.querySelector('[data-field="eraser"]') ?? null,
      fillSetting: byId('fillSetting'),
      toolSettingsTitle: byId('toolSettingsTitle'),
      toolSettingsHint: byId('toolSettingsHint'),
      pageThumbnails: byId('pageThumbnails'),
      pagePanelHead: pagePanel?.querySelector('.page-panel-head') ?? null,
      toolSettingsHead:
        toolSettingsPanel?.querySelector('.tool-settings-head') ?? null,
      pageTab: toolSettingsPanel?.querySelector('.tool-tab[data-tab="page"]') ?? null
    },
    qr: {
      overlay: byId('qrOverlay'),
      codeContainer: byId('qr'),
      codeText: byId('qrCodeText'),
      url: byId('qrUrl'),
      copyFeedback: byId('copyUrlFeedback')
    },
    misc: {
      codeWrapper: byId('codeWrapper'),
      eraserCursor: byId('eraserCursor'),
      statusText: byId('statusText'),
      guestList: byId('guestList'),
      guestEmpty: byId('guestEmpty'),
      guestPanelTitle: byId('guestPanelTitle'),
      guestRequestHint: byId('guestRequestHint')
    }
  };
}
