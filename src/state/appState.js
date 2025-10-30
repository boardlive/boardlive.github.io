export const appState = {
  session: {
    peer: null,
    conn: null,
    clientId: null,
    guests: new Map(),
    guestCounter: 0,
    guestAccessMode: 'host-only',
    guestName: '',
    guestRequestPending: false,
    isHost: false,
    guestLock: true,
    remoteLock: false,
    allowHostStart: false,
    hostButtonState: 'idle',
    joinButtonState: 'idle',
    shareUrl: '',
    stateRequestTimeout: null,
    lastGuestViewportSignature: null
  },
  canvas: {
    cssHeight: null,
    cssWidth: null,
    lastViewportHeight: null,
    lastViewportWidth: null,
    viewportAdjustFrame: null,
    viewportAdjustTimeout: null,
    drawing: false,
    drawingShape: false,
    lastPoint: null,
    lastMidpoint: null,
    shapeStart: null,
    shapeSnapshot: null,
    erasing: false,
    tempErasePointerId: null,
    eraseModeBeforeOverride: false,
    canvasScale: 1,
    activePointerId: null,
    touchPanActive: false,
    historyActionStarted: false,
    undoStack: [],
    redoStack: []
  },
  tools: {
    currentTool: 'pen',
    toolSettingsOpen: false,
    toolSettingsPane: 'tool',
    toolSettingsPinned: false,
    toolSettingsHasCustomPosition: false,
    toolSettingsPosition: { left: null, top: null },
    toolSettingsDrag: {
      active: false,
      pointerId: null,
      offsetX: 0,
      offsetY: 0,
      width: 0,
      height: 0
    }
  },
  pages: {
    pages: [],
    activePageId: null,
    pageOrderCounter: 0,
    pagePanelOpen: false,
    pagePanelPosition: { left: null, top: null },
    pagePanelDrag: {
      active: false,
      pointerId: null,
      offsetX: 0,
      offsetY: 0,
      width: 0,
      height: 0
    },
    pendingSnapshotFrame: null
  },
  ui: {
    manualMenuState: null,
    copyFeedbackTimeout: null,
    boardExpanded: false,
    activeSection: 'session',
    qrInstance: null,
    currentBackground: '#ffffff',
    currentBackgroundColor: '#ffffff',
    currentBackgroundImage: null,
    currentBackgroundSize: null,
    currentBackgroundPattern: 'solid',
    guestPanelOpen: false
  },
  images: {
    activeImageOverlay: null,
    activeImageState: null,
    imageDragState: null,
    imageResizeState: null
  }
};
