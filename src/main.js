import { collectDomRefs } from './dom/domRefs.js';
import { appState } from './state/appState.js';
import {
  isShapeTool,
  getToolSize,
  toolStrokeColor,
  toolFillColor,
  initToolsModule
} from './modules/toolsModule.js';
import { initCanvasModule } from './modules/canvasModule.js';
import { initPagesModule } from './modules/pagesModule.js';
import { initUiModule } from './modules/uiModule.js';
import { initNetworkModule } from './modules/networkModule.js';

if(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions){
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const domRefs = collectDomRefs();
const { status: statusEl } = domRefs;

if (statusEl && !statusEl.dataset.state) {
  statusEl.dataset.state = 'disconnected';
}

let networkModule = null;
let uiModule = null;
const toolsModule = initToolsModule({ appState, domRefs });
const {
  setCurrentTool,
  setToolSettingsPane,
  setToolSettingsOpen,
  forceCloseToolSettings,
  updateToolSettingsUi,
  setEraserMode,
  updateEraserLabel
} = toolsModule;

const canvasNetworkApi = {
  emitStroke: (...args) => networkModule?.emitStroke(...args),
  emitShape: (...args) => networkModule?.emitShape(...args),
  emitClear: (...args) => networkModule?.emitClear(...args),
  emitImage: (...args) => networkModule?.emitImage(...args),
  emitCanvasSnapshot: (...args) =>
    networkModule?.broadcastCanvasSnapshot(...args),
  emitViewport: (...args) =>
    networkModule?.broadcastViewport(...args),
  requestStateRefresh: (...args) =>
    networkModule?.requestStateRefresh(...args)
};

const canvasModule = initCanvasModule({
  appState,
  domRefs,
  toolsApi: toolsModule,
  networkApi: canvasNetworkApi
});

const {
  registerPagesApi,
  expandCanvasToViewport,
  adjustGuestView,
  applyBackgroundColor,
  performUndo,
  performRedo,
  placeImageOnCanvas,
  updateHistoryUi
} = canvasModule;

const pagesModule = initPagesModule({
  appState,
  domRefs,
  canvasApi: canvasModule,
  networkApi: {
    broadcast: (...args) => networkModule?.broadcast(...args)
  },
  uiApi: {
    onViewToggle: () => uiModule?.updateViewToggle()
  }
});

const {
  getActivePage,
  setActivePage,
  renderPageThumbnails,
  saveCurrentPageState,
  schedulePageSnapshot,
  serializePages,
  ensurePagePanelWithinViewport,
  setPagePanelOpen,
  syncPagesFromHost,
  enterBoardFullscreen,
  exitBoardFullscreen
} = pagesModule;

uiModule = initUiModule({
  appState,
  domRefs,
  toolsApi: {
    setToolSettingsPane,
    setToolSettingsOpen,
    forceCloseToolSettings,
    updateToolSettingsUi,
    setEraserMode,
    updateEraserLabel
  },
  canvasApi: {
    expandCanvasToViewport,
    adjustGuestView,
    applyBackgroundColor,
    performUndo,
    performRedo,
    placeImageOnCanvas
  },
  pagesApi: {
    setPagePanelOpen,
    enterBoardFullscreen,
    exitBoardFullscreen
  }
});

registerPagesApi({
  scheduleSnapshot: schedulePageSnapshot,
  saveCurrentPageState,
  getActivePage,
  renderThumbnails: renderPageThumbnails,
  ensurePanelWithinViewport: ensurePagePanelWithinViewport,
  applyBackground: (...args) => uiModule.onBackgroundApplied(...args)
});

networkModule = initNetworkModule({
  appState,
  domRefs,
  canvasApi: canvasModule,
  pagesApi: {
    getActivePage,
    renderPageThumbnails,
    schedulePageSnapshot,
    serializePages,
    setActivePage,
    syncPagesFromHost
  },
  toolsApi: {
    setEraserMode,
    toolStrokeColor,
    toolFillColor,
    getToolSize,
    isShapeTool
  },
  uiApi: {
    setStatus: (...args) => uiModule.setStatus(...args),
    refreshUi: (...args) => uiModule.refreshUi(...args),
    applyHostButtonState: (...args) => uiModule.applyHostButtonState(...args),
    applyJoinButtonState: (...args) => uiModule.applyJoinButtonState(...args),
    updateShareLinkUi: (...args) => uiModule.updateShareLinkUi(...args),
    hideQr: (...args) => uiModule.hideQr(...args)
  }
});

uiModule.registerNetworkApi({
  broadcast: (...args) => networkModule.broadcast(...args),
  startHost: (...args) => networkModule.startHost(...args),
  startGuest: (...args) => networkModule.startGuest(...args),
  cleanupPeer: (...args) => networkModule.cleanupPeer(...args)
});

setCurrentTool('pen', { silent: true });
updateHistoryUi();
