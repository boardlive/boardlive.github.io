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
  updateEraserLabel,
  ensureToolSettingsWithinViewport
} = toolsModule;

const canvasNetworkApi = {
  emitStroke: (...args) => networkModule?.emitStroke(...args),
  emitShape: (...args) => networkModule?.emitShape(...args),
  emitClear: (...args) => networkModule?.emitClear(...args),
  emitImage: (...args) => networkModule?.emitImage(...args),
  emitBackground: (...args) => networkModule?.emitBackground?.(...args),
  emitCanvasSnapshot: (...args) =>
    networkModule?.broadcastCanvasSnapshot(...args),
  emitViewport: (...args) =>
    networkModule?.broadcastViewport(...args),
  requestStateRefresh: (...args) =>
    networkModule?.requestStateRefresh(...args),
  requestUndo: (...args) => networkModule?.requestUndo(...args),
  requestRedo: (...args) => networkModule?.requestRedo(...args),
  notifyActionState: (...args) =>
    networkModule?.notifyActionStateFromCanvas?.(...args)
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
    broadcast: (...args) => networkModule?.broadcast(...args),
    requestPageAdd: (...args) => networkModule?.requestPageAdd(...args),
    requestPageRemove: (...args) =>
      networkModule?.requestPageRemove(...args),
    requestSetActivePage: (...args) =>
      networkModule?.requestSetActivePage(...args)
  },
  uiApi: {
    onViewToggle: () => uiModule?.updateViewToggle(),
    onBoardFullscreenChange: payload =>
      uiModule?.handleBoardFullscreenChange?.(payload)
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
  exitBoardFullscreen,
  addNewPage,
  removePage
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
    updateEraserLabel,
    ensureToolSettingsWithinViewport
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
    addNewPage,
    removePage,
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
    hideQr: (...args) => uiModule.hideQr(...args),
    updateGuestRoster: (...args) => uiModule.updateGuestRoster(...args)
  }
});

uiModule.registerNetworkApi({
  broadcast: (...args) => networkModule.broadcast(...args),
  startHost: (...args) => networkModule.startHost(...args),
  startGuest: (...args) => networkModule.startGuest(...args),
  cleanupPeer: (...args) => networkModule.cleanupPeer(...args),
  setGuestAccessMode: (...args) => networkModule.setGuestAccessMode(...args),
  setGuestCanDraw: (...args) => networkModule.setGuestCanDraw(...args),
  sendGuestName: (...args) => networkModule.sendGuestName(...args),
  setGuestRequestState: (...args) => networkModule.setGuestRequestState(...args)
});

setCurrentTool('pen', { silent: true });
updateHistoryUi();
