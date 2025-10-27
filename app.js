if(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions){
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ===== Configuración PeerJS/STUN-TURN =====
const peerConfig = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: 'turn:standard.relay.metered.ca:80', username: '9745e21b303bdaea589c29bc', credential: 'UgG56tBqCEGNjzLY' },
      { urls: 'turn:standard.relay.metered.ca:443?transport=tcp', username: '9745e21b303bdaea589c29bc', credential: 'UgG56tBqCEGNjzLY' }
    ]
  }
};

let peer = null;          // instancia local
let conn = null;          // conexión a anfitrión (cuando eres cliente)
const guests = new Map(); // conexiones a invitados (cuando eres anfitrión)
let isHost = false;
let drawing = false;
let lastPoint = null;     // último punto registrado
let lastMidpoint = null;  // último punto medio para suavizado
let erasing = false;
let tempErasePointerId = null;
let eraseModeBeforeOverride = false;
let guestLock = true;     // bloqueo impuesto por el anfitrión (por defecto solo anfitrión dibuja)
let remoteLock = false;   // bloqueo recibido cuando eres invitado
const statusEl = document.getElementById('status');
if(statusEl && !statusEl.dataset.state){ statusEl.dataset.state = 'disconnected'; }

const board = document.getElementById('board');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let cssHeight = null; // altura del canvas en CSS px
let cssWidth = null;

function viewportInfo(){
  const vv = window.visualViewport;
  if(vv){
    return {
      width: Math.round(vv.width || window.innerWidth || canvas?.clientWidth || 0),
      height: Math.round(vv.height || window.innerHeight || canvas?.clientHeight || 0),
      scale: vv.scale || 1
    };
  }
  return {
    width: Math.round(window.innerWidth || canvas?.clientWidth || 0),
    height: Math.round(window.innerHeight || canvas?.clientHeight || 0),
    scale: 1
  };
}

let lastViewportHeight = null;
let lastViewportWidth = null;
let viewportAdjustFrame = null;
let viewportAdjustTimeout = null;
let stateRequestTimeout = null;
let lastGuestViewportSignature = null;

// ===== Canvas escalado HiDPI + altura dinámica =====
function setCanvasCssHeight(h){
  canvas.style.height = h+"px"; // esto dispara el ResizeObserver
  applyCanvasWidth();
  adjustGuestView();
}

function applyCanvasWidth(){
  if(typeof cssWidth === 'number' && !isHost){
    canvas.style.width = cssWidth + "px";
    canvas.style.maxWidth = 'none';
  } else {
    canvas.style.width = '';
    canvas.style.removeProperty('max-width');
  }
  syncCanvasResolution({preserve:true});
  if(erasing) updateEraserCursorSize();
}

function syncCanvasResolution({preserve=true} = {}){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight));
  const targetW = Math.max(1, Math.round(w * dpr));
  const targetH = Math.max(1, Math.round(h * dpr));
  if(canvas.width === targetW && canvas.height === targetH) return;
  let snapshot = null;
  if(preserve){
    try{ snapshot = ctx.getImageData(0,0,canvas.width,canvas.height); }catch(e){}
  }
  canvas.width = targetW;
  canvas.height = targetH;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  if(snapshot){
    try{ ctx.putImageData(snapshot,0,0); }catch(e){}
  }
}

function headerHeight(){
  return headerEl ? headerEl.offsetHeight : 56;
}

function desiredCanvasHeight(){
  const { height } = viewportInfo();
  const viewportHeight = Number.isFinite(height) ? height : window.innerHeight;
  const value = Math.round(viewportHeight - headerHeight());
  return Math.max(200, value);
}

function syncViewportWithGuests(){
  if(!isHost) return;
  if(typeof cssHeight !== 'number') return;
  const { width: viewportWidth } = viewportInfo();
  const width = Math.round(canvas.clientWidth || board.clientWidth || viewportWidth || window.innerWidth || 0);
  if(width <= 0) return;
  if(lastViewportHeight === cssHeight && lastViewportWidth === width) return;
  lastViewportHeight = cssHeight;
  lastViewportWidth = width;
  broadcast({type:'viewport', h: cssHeight, w: width});
}

function expandCanvasToViewport(force=false){
  const target = desiredCanvasHeight();
  const connected = !!(conn && conn.open);
  let next = cssHeight;
  if(isHost){
    if(cssHeight === null || force) next = target;
    if(next !== cssHeight){
      cssHeight = next;
      setCanvasCssHeight(cssHeight);
      syncViewportWithGuests();
    } else if(force && cssHeight !== null){
      setCanvasCssHeight(cssHeight);
      syncViewportWithGuests();
    }
    return;
  }
  if(!connected){
    if(cssHeight === null || force) next = target;
    else if(typeof cssHeight === 'number' && target > cssHeight) next = target;
    if(next !== cssHeight){
      cssHeight = next;
      setCanvasCssHeight(cssHeight);
    } else if(force && cssHeight !== null){
      setCanvasCssHeight(cssHeight);
    }
  } else if(force && typeof cssHeight === 'number'){
    setCanvasCssHeight(cssHeight);
  }
}

function resizeInternal(){
  syncCanvasResolution({preserve:true});
}
const ro = new ResizeObserver(()=> resizeInternal());
ro.observe(canvas);
window.addEventListener('load', ()=>{
  expandCanvasToViewport(true);
  applyMenuState();
});

// ===== Utiles =====
const $ = (id)=>document.getElementById(id);
function rndCode(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function sanitizeCode(raw){
  const upper = (raw ?? '').toString().trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9-]/g, '');
  return cleaned.slice(0, 32);
}
function setStatus(text, state='disconnected'){
  if(!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}
const colorInput = $('color');
const sizeInput = $('size');
const eraserSizeInput = $('eraserSize');
const eraserBtn = $('eraser');
const clearBtn = $('clear');
const openPdfBtn = $('openPdf');
const savePdfBtn = $('savePdf');
const bgInput = $('bg');
const readonlyToggle = $('readonly');
const lockToggle = $('lockGuests');
const codeInput = $('code');
const codeWrapper = $('codeWrapper');
const hostBtn = $('hostBtn');
const joinBtn = $('joinBtn');
const copyUrlBtn = $('copyUrlBtn');
const copyUrlFeedback = $('copyUrlFeedback');
const qrOverlay = $('qrOverlay');
const qrClose = $('qrClose');
const qrUrl = $('qrUrl');
const qrCodeText = $('qrCodeText');
const qrBtn = $('qrBtn');
const pagePanelEl = $('pagePanel');
const pagePanelHead = pagePanelEl?.querySelector('.page-panel-head');
const pageThumbnailsEl = $('pageThumbnails');
const pageAddBtn = $('pageAdd');
const pagePrevBtn = $('pagePrev');
const pageNextBtn = $('pageNext');
const pageToggleBtn = $('pageToggle');
const pageCloseBtn = $('pageClose');
const pdfInput = $('pdfInput');
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
const undoBtn = $('undo');
const redoBtn = $('redo');
const insertImageBtn = $('insertImage');
const imageInput = $('imageInput');
const guestControls = [colorInput, sizeInput, eraserBtn, eraserSizeInput, ...toolButtons].filter(Boolean);
const headerEl = document.querySelector('header');
const viewToggleBtn = $('viewToggle');
let canvasScale = 1;
const menuToggleBtn = $('menuToggle');
const toolbarControls = $('toolbarControls');
const toolbarNav = document.querySelector('.toolbar-nav');
const menuQuery = window.matchMedia('(max-width: 900px)');
let manualMenuState = null;
const hostOnlyEls = Array.from(document.querySelectorAll('.host-only'));
const editControlEls = Array.from(document.querySelectorAll('.edit-only'));
const roleLabel = $('roleLabel');
const eraserCursorEl = $('eraserCursor');
const sectionButtons = Array.from(document.querySelectorAll('.toolbar-nav .tab-btn[data-target]'));
const toolbarSections = Array.from(document.querySelectorAll('.toolbar-section'));
const sectionsMap = new Map(toolbarSections.map(sec=> [sec.dataset.section, sec]));
let activeSection = toolbarControls?.dataset.active || 'session';
let copyFeedbackTimeout = null;
let qrInstance = null;
let shareUrl = '';
let currentBg = bgInput?.value || '#ffffff';
const pages = [];
let activePageId = null;
let pageOrderCounter = 0;
let pagePanelOpen = false;
let pendingSnapshotFrame = null;
let boardExpanded = false;
const pagePanelPosition = { left:null, top:null };
const pagePanelDrag = { active:false, pointerId:null, offsetX:0, offsetY:0, width:0, height:0 };
const PAGE_PANEL_MARGIN = 12;
const HISTORY_LIMIT = 30;
const undoStack = [];
const redoStack = [];
let historyActionStarted = false;
let currentTool = 'pen';
let shapeStart = null;
let shapeSnapshot = null;
let drawingShape = false;
const HIGHLIGHT_ALPHA = 0.32;
let activeImageOverlay = null;
let activeImageState = null;
let imageDragState = null;
let imageResizeState = null;
const IMAGE_MIN_SIZE = 48;

if(pageToggleBtn && !pageToggleBtn.getAttribute('aria-label')){
  pageToggleBtn.setAttribute('aria-label', 'Mostrar páginas');
}

const hostButtonConfig = {
  idle: { label:'🖥️ Compartir mi pizarra' },
  pending: { label:'🖥️ Creando conexión…', ariaBusy:true, disabled:true },
  active: { label:'🖥️ Pizarra compartida', title:'Pulsa para dejar de compartir' },
  error: { label:'🖥️ Reintentar compartir' }
};
let hostButtonState = hostBtn?.dataset.state || 'idle';
let allowHostStart = false;
function applyHostButtonState(state='idle'){
  hostButtonState = state;
  const cfg = hostButtonConfig[state] || hostButtonConfig.idle;
  if(hostBtn){
    hostBtn.dataset.state = state;
    hostBtn.textContent = cfg.label;
    if(cfg.title) hostBtn.title = cfg.title;
    else hostBtn.removeAttribute('title');
    if(cfg.disabled) hostBtn.setAttribute('disabled', '');
    else hostBtn.removeAttribute('disabled');
    if(cfg.ariaBusy) hostBtn.setAttribute('aria-busy', 'true');
    else hostBtn.removeAttribute('aria-busy');
  }
  updateCodeInputVisibility();
}

const joinButtonConfig = {
  idle: { label:'👥 Unirme a una pizarra' },
  pending: { label:'👥 Conectando con el anfitrión…', ariaBusy:true, disabled:true },
  active: { label:'👥 Conectado a la pizarra', title:'Pulsa para desconectar' },
  error: { label:'👥 Reintentar conexión' }
};
let joinButtonState = joinBtn?.dataset.state || 'idle';
function applyJoinButtonState(state='idle'){
  if(!joinBtn) return;
  joinButtonState = state;
  const cfg = joinButtonConfig[state] || joinButtonConfig.idle;
  joinBtn.dataset.state = state;
  joinBtn.textContent = cfg.label;
  if(cfg.title) joinBtn.title = cfg.title;
  else joinBtn.removeAttribute('title');
  if(cfg.disabled) joinBtn.setAttribute('disabled', '');
  else joinBtn.removeAttribute('disabled');
  if(cfg.ariaBusy) joinBtn.setAttribute('aria-busy', 'true');
  else joinBtn.removeAttribute('aria-busy');
}

function updateCodeInputVisibility(){
  if(!codeWrapper) return;
  const hostActive = isHost && (hostButtonState === 'pending' || hostButtonState === 'active');
  const guestConnected = !isHost && !!(conn && conn.open);
  const hide = hostActive || guestConnected;
  codeWrapper.classList.toggle('hidden', hide);
}

function updateViewToggle(){
  if(!viewToggleBtn) return;
  viewToggleBtn.dataset.active = boardExpanded ? 'true' : 'false';
  viewToggleBtn.setAttribute('aria-pressed', boardExpanded ? 'true' : 'false');
  viewToggleBtn.textContent = boardExpanded ? '↺ Salir' : '⛶ Maximizar';
  viewToggleBtn.title = boardExpanded ? 'Salir de pantalla completa' : 'Maximizar área de dibujo';
}

function isShapeTool(tool){
  return tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

function updateToolSelection(){
  toolButtons.forEach(btn=>{
    const tool = btn.dataset.tool;
    const active = !erasing && currentTool === tool;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.classList.toggle('active', active);
  });
  updateCanvasCursor();
}

function setCurrentTool(tool, { silent=false } = {}){
  const allowed = ['pen', 'line', 'rect', 'ellipse', 'highlight'];
  const next = allowed.includes(tool) ? tool : 'pen';
  currentTool = next;
  if(erasing){
    erasing = false;
    updateEraserLabel();
  }
  if(!silent) updateToolSelection();
}

function effectiveTool(){
  if(erasing) return 'eraser';
  return currentTool;
}

function updateCanvasCursor(){
  if(!canvas) return;
  const tool = effectiveTool();
  let cursor = 'crosshair';
  if(tool === 'eraser') cursor = 'cell';
  canvas.style.cursor = cursor;
}

function hexToRgb(hex){
  const normalized = hex?.toString().trim();
  if(!normalized || !/^#?[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  const r = parseInt(value.slice(0,2), 16);
  const g = parseInt(value.slice(2,4), 16);
  const b = parseInt(value.slice(4,6), 16);
  return {r,g,b};
}

function highlightColor(base){
  const rgb = hexToRgb(base);
  if(!rgb) return 'rgba(255,255,0,0.32)';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${HIGHLIGHT_ALPHA})`;
}

function parsePoint(raw){
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if(Number.isFinite(x) && Number.isFinite(y)) return {x, y};
  return null;
}

function currentStrokeColor(){
  const base = colorInput?.value || '#000000';
  if(effectiveTool() === 'highlight') return highlightColor(base);
  return base;
}

function beginHistoryAction(){
  if(historyActionStarted) return;
  const snapshot = canvasSnapshot();
  if(undoStack.length === 0 || undoStack[undoStack.length - 1] !== snapshot){
    undoStack.push(snapshot);
    if(undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  historyActionStarted = true;
}

function commitHistoryAction(){
  if(!historyActionStarted) return;
  const snapshot = canvasSnapshot();
  if(undoStack[undoStack.length - 1] !== snapshot){
    undoStack.push(snapshot);
    if(undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  redoStack.length = 0;
  historyActionStarted = false;
  updateHistoryUi();
}

function resetHistory(){
  undoStack.length = 0;
  redoStack.length = 0;
  historyActionStarted = false;
  undoStack.push(canvasSnapshot());
  updateHistoryUi();
}

function updateHistoryUi(){
  if(undoBtn){
    undoBtn.disabled = undoStack.length <= 1;
  }
  if(redoBtn){
    redoBtn.disabled = redoStack.length === 0;
  }
}

function broadcastCanvasSnapshot(){
  if(!isHost) return;
  const snapshot = canvasSnapshot();
  broadcast({ type:'canvas', image: snapshot, bg: currentBg });
}

function applyPagePanelPosition(){
  if(!pagePanelEl) return;
  if(Number.isFinite(pagePanelPosition.left) && Number.isFinite(pagePanelPosition.top)){
    pagePanelEl.style.left = `${pagePanelPosition.left}px`;
    pagePanelEl.style.top = `${pagePanelPosition.top}px`;
    pagePanelEl.style.right = 'auto';
    pagePanelEl.style.bottom = 'auto';
  } else {
    pagePanelEl.style.left = '';
    pagePanelEl.style.top = '';
    pagePanelEl.style.right = '';
    pagePanelEl.style.bottom = '';
  }
}

function ensurePagePanelWithinViewport(){
  if(!pagePanelEl || pagePanelEl.hasAttribute('hidden')) return;
  const rect = pagePanelEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  const width = rect.width;
  const height = rect.height;
  const maxLeft = Math.max(PAGE_PANEL_MARGIN, window.innerWidth - width - PAGE_PANEL_MARGIN);
  const maxTop = Math.max(PAGE_PANEL_MARGIN, window.innerHeight - height - PAGE_PANEL_MARGIN);
  let adjusted = false;
  if(left < PAGE_PANEL_MARGIN){
    left = PAGE_PANEL_MARGIN;
    adjusted = true;
  } else if(left > maxLeft){
    left = maxLeft;
    adjusted = true;
  }
  if(top < PAGE_PANEL_MARGIN){
    top = PAGE_PANEL_MARGIN;
    adjusted = true;
  } else if(top > maxTop){
    top = maxTop;
    adjusted = true;
  }
  if(adjusted || Number.isFinite(pagePanelPosition.left)){
    pagePanelPosition.left = left;
    pagePanelPosition.top = top;
    applyPagePanelPosition();
  }
}

function setPagePanelDragging(active){
  if(!pagePanelEl) return;
  if(active){
    pagePanelEl.dataset.dragging = 'true';
  } else {
    delete pagePanelEl.dataset.dragging;
  }
}

function startPagePanelDrag(e){
  if(!pagePanelEl) return;
  const isPrimary = e.button === undefined || e.button === 0;
  if(!isPrimary) return;
  if(e.target && e.target.closest('button')) return;
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
  if(pagePanelEl.setPointerCapture && e.pointerId !== undefined){
    try{ pagePanelEl.setPointerCapture(e.pointerId); }catch(err){}
  }
  setPagePanelDragging(true);
  e.preventDefault();
}

function updatePagePanelDrag(e){
  if(!pagePanelDrag.active) return;
  if(pagePanelDrag.pointerId !== 'mouse' && e.pointerId !== undefined && e.pointerId !== pagePanelDrag.pointerId) return;
  const width = pagePanelDrag.width || (pagePanelEl?.offsetWidth ?? 0);
  const height = pagePanelDrag.height || (pagePanelEl?.offsetHeight ?? 0);
  const maxLeft = Math.max(PAGE_PANEL_MARGIN, window.innerWidth - width - PAGE_PANEL_MARGIN);
  const maxTop = Math.max(PAGE_PANEL_MARGIN, window.innerHeight - height - PAGE_PANEL_MARGIN);
  const baseLeft = e.clientX - pagePanelDrag.offsetX;
  const baseTop = e.clientY - pagePanelDrag.offsetY;
  const nextLeft = clamp(baseLeft, PAGE_PANEL_MARGIN, maxLeft);
  const nextTop = clamp(baseTop, PAGE_PANEL_MARGIN, maxTop);
  pagePanelPosition.left = nextLeft;
  pagePanelPosition.top = nextTop;
  applyPagePanelPosition();
  e.preventDefault();
}

function endPagePanelDrag(e){
  if(!pagePanelDrag.active) return;
  if(pagePanelDrag.pointerId !== 'mouse' && e.pointerId !== undefined && e.pointerId !== pagePanelDrag.pointerId) return;
  pagePanelDrag.active = false;
  pagePanelDrag.pointerId = null;
  pagePanelDrag.offsetX = 0;
  pagePanelDrag.offsetY = 0;
  if(pagePanelEl?.releasePointerCapture && e.pointerId !== undefined){
    try{ pagePanelEl.releasePointerCapture(e.pointerId); }catch(err){}
  }
  setPagePanelDragging(false);
  e.preventDefault();
}

function fullscreenElement(){
  return document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
    || null;
}

function isBoardFullscreen(){
  const el = fullscreenElement();
  return !!el && (el === board);
}

async function enterBoardFullscreen(){
  const target = board || document.documentElement;
  if(!target) return;
  try{
    if(target.requestFullscreen){
      await target.requestFullscreen({ navigationUI:'hide' });
      handleFullscreenChange();
      return;
    }
  } catch(err){
    console.warn('No se pudo activar pantalla completa estándar:', err);
  }
  const fallback = target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
  if(typeof fallback === 'function'){
    try{
      fallback.call(target);
      setTimeout(handleFullscreenChange, 0);
    }catch(err){
      console.warn('No se pudo activar pantalla completa (fallback):', err);
    }
  } else {
    alert('Este navegador no permite la pantalla completa desde la aplicación.');
  }
}

function exitBoardFullscreen(){
  if(!isBoardFullscreen()){
    boardExpanded = false;
    delete document.body.dataset.boardExpanded;
    updateViewToggle();
    expandCanvasToViewport(true);
    adjustGuestView();
    ensurePagePanelWithinViewport();
    return;
  }
  if(document.exitFullscreen){
    document.exitFullscreen().catch(err=>{
      console.warn('Error al salir de pantalla completa:', err);
    }).finally(()=> handleFullscreenChange());
    return;
  }
  const fallback = document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if(typeof fallback === 'function'){
    try{
      fallback.call(document);
      setTimeout(handleFullscreenChange, 0);
    }catch(err){
      console.warn('No se pudo salir de pantalla completa (fallback):', err);
    }
  }
}

function handleFullscreenChange(){
  const active = isBoardFullscreen();
  boardExpanded = active;
  if(active){
    document.body.dataset.boardExpanded = 'true';
    setPagePanelOpen(false);
  } else {
    delete document.body.dataset.boardExpanded;
  }
  updateViewToggle();
  scheduleViewportAdjust({ force:true });
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);
handleFullscreenChange();

function setPagePanelOpen(open){
  const desired = !!open;
  if(pagePanelOpen === desired) return;
  pagePanelOpen = desired;
  if(pagePanelEl){
    if(desired){
      pagePanelEl.removeAttribute('hidden');
      applyPagePanelPosition();
      ensurePagePanelWithinViewport();
      renderPageThumbnails();
    } else {
      setPagePanelDragging(false);
      pagePanelEl.setAttribute('hidden', '');
    }
  }
  if(pageToggleBtn){
    pageToggleBtn.setAttribute('aria-expanded', desired ? 'true' : 'false');
    pageToggleBtn.setAttribute('aria-label', desired ? 'Ocultar páginas' : 'Mostrar páginas');
  }
}

function generatePageId(){
  if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'){
    return crypto.randomUUID();
  }
  return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createPage({ id = generatePageId(), bg = currentBg, image = null, order = null } = {}){
  pageOrderCounter = Math.max(pageOrderCounter, order ?? pageOrderCounter);
  return {
    id,
    bg: typeof bg === 'string' ? bg : '#ffffff',
    image: image ?? null,
    order: order ?? (++pageOrderCounter)
  };
}

function getActivePage(){
  return pages.find(page=> page.id === activePageId) || null;
}

function findPageIndex(id){
  return pages.findIndex(page=> page.id === id);
}

function updatePageNavButtons(){
  if(!pagePrevBtn || !pageNextBtn) return;
  const idx = findPageIndex(activePageId);
  if(pages.length <= 1 || idx <= 0){
    pagePrevBtn.setAttribute('disabled', 'true');
  } else {
    pagePrevBtn.removeAttribute('disabled');
  }
  if(pages.length <= 1 || idx === pages.length - 1){
    pageNextBtn.setAttribute('disabled', 'true');
  } else {
    pageNextBtn.removeAttribute('disabled');
  }
}

function renderPageThumbnails({ force=false } = {}){
  if(!pageThumbnailsEl) return;
  if(!pagePanelOpen && !force) return;
  pageThumbnailsEl.innerHTML = '';
  if(pages.length === 0){
    const empty = document.createElement('div');
    empty.className = 'page-empty-thumb';
    empty.textContent = 'Sin páginas';
    pageThumbnailsEl.appendChild(empty);
    updatePageNavButtons();
    return;
  }
  pages.forEach((page, idx)=>{
    const wrap = document.createElement('div');
    wrap.className = 'page-thumb-wrap';
    wrap.dataset.pageId = page.id;
    const thumbBtn = document.createElement('button');
    thumbBtn.type = 'button';
    thumbBtn.className = 'page-thumb';
    thumbBtn.dataset.pageId = page.id;
    const isActive = page.id === activePageId;
    thumbBtn.dataset.active = isActive ? 'true' : 'false';
    thumbBtn.dataset.hasImg = page.image ? 'true' : 'false';
    if(page.image){
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
    if(pages.length <= 1){
      delBtn.setAttribute('disabled', 'true');
    }
    wrap.appendChild(delBtn);
    pageThumbnailsEl.appendChild(wrap);
  });
  updatePageNavButtons();
}

function blankPageDataUrl(bg='#ffffff'){
  const off = document.createElement('canvas');
  off.width = canvas?.width || 1280;
  off.height = canvas?.height || 720;
  const offCtx = off.getContext('2d');
  offCtx.fillStyle = bg;
  offCtx.fillRect(0,0,off.width,off.height);
  return off.toDataURL('image/png');
}

function saveCurrentPageState(){
  finalizeActiveImageIfPresent();
  const page = getActivePage();
  if(!page || !canvas) return;
  syncCanvasResolution({preserve:true});
  page.bg = currentBg;
  page.image = canvasSnapshot();
}

function schedulePageSnapshot(){
  if(!isHost) return;
  if(pendingSnapshotFrame !== null) return;
  pendingSnapshotFrame = requestAnimationFrame(()=>{
    pendingSnapshotFrame = null;
    saveCurrentPageState();
    renderPageThumbnails();
  });
}

function snapshotForPage(page){
  if(!page) return null;
  if(page.id === activePageId){
    saveCurrentPageState();
    return page.image;
  }
  if(page.image) return page.image;
  return blankPageDataUrl(page.bg);
}

function serializePages({ refreshActive=false } = {}){
  if(refreshActive) saveCurrentPageState();
  return pages.map(page=>({
    id: page.id,
    bg: page.bg,
    order: page.order,
    image: page.image || (isHost ? canvasSnapshot() : null)
  }));
}

function applyPageToCanvas(page){
  if(!page){
    clearCanvas();
    applyBackground('#ffffff', false);
    return;
  }
  applyBackground(page.bg || '#ffffff', false);
  if(page.image){
    applySnapshot(page.image);
  } else {
    clearCanvas();
  }
}

function setActivePage(id, { broadcast=true, fromSync=false } = {}){
  if(!id) return;
  finalizeActiveImageIfPresent();
  if(activePageId === id && !fromSync){
    if(isHost && broadcast) broadcastPages();
    return;
  }
  if(isHost && !fromSync){
    saveCurrentPageState();
  }
  const page = pages.find(p=> p.id === id);
  if(!page) return;
  activePageId = id;
  applyPageToCanvas(page);
  resetHistory();
  renderPageThumbnails({ force:true });
  if(isHost && broadcast){
    broadcastPages();
    broadcastPageChange(activePageId);
    syncViewportWithGuests();
  }
}

function addNewPage({ bg, image } = {}){
  finalizeActiveImageIfPresent();
  const baseBg = typeof bg === 'string' ? bg : currentBg;
  if(isHost) saveCurrentPageState();
  const newPage = createPage({ bg: baseBg, image });
  const currentIndex = findPageIndex(activePageId);
  const insertAt = currentIndex >= 0 ? currentIndex + 1 : pages.length;
  pages.splice(insertAt, 0, newPage);
  setActivePage(newPage.id, { broadcast:false });
  renderPageThumbnails();
  if(isHost){
    broadcastPages();
    broadcastPageChange(activePageId);
  }
}

function removePage(id){
  if(pages.length <= 1) return;
  finalizeActiveImageIfPresent();
  const index = findPageIndex(id);
  if(index === -1) return;
  if(isHost && pages[index].id === activePageId){
    saveCurrentPageState();
  }
  const wasActive = pages[index].id === activePageId;
  pages.splice(index, 1);
  if(!pages.length){
    const fallback = createPage({ bg: currentBg });
    pages.push(fallback);
    activePageId = fallback.id;
  } else if(wasActive){
    const next = pages[index] ?? pages[index-1] ?? pages[0];
    activePageId = next.id;
  }
  applyPageToCanvas(getActivePage());
  renderPageThumbnails();
  if(isHost){
    broadcastPages();
    broadcastPageChange(activePageId);
  }
}

function stepPage(delta){
  if(!pages.length) return;
  const index = findPageIndex(activePageId);
  if(index === -1) return;
  const nextIndex = Math.min(pages.length - 1, Math.max(0, index + delta));
  if(nextIndex === index) return;
  setActivePage(pages[nextIndex].id);
}

function resetPages({ bg=currentBg, image=null, preserveCanvas=false } = {}){
  pageOrderCounter = 0;
  pages.length = 0;
  const initial = createPage({ bg, image });
  pages.push(initial);
  activePageId = initial.id;
  if(!preserveCanvas){
    clearCanvas();
    applyBackground(initial.bg, false);
    if(initial.image){
      applySnapshot(initial.image);
    }
  }
  renderPageThumbnails();
  resetHistory();
}

function applyImportedPdfPages(images, { background='#ffffff' } = {}){
  if(!Array.isArray(images) || images.length === 0) return;
  const bg = typeof background === 'string' ? background : '#ffffff';
  pageOrderCounter = 0;
  pages.length = 0;
  images.forEach(img=>{
    const page = createPage({ bg: bg, image: img });
    pages.push(page);
  });
  activePageId = pages[0]?.id ?? null;
  const activePage = getActivePage();
  if(activePage){
    applyPageToCanvas(activePage);
  } else {
    clearCanvas();
    applyBackground(bg, false);
  }
  renderPageThumbnails();
  applyBackground(bg);
  if(isHost){
    broadcastPages();
    broadcastPageChange(activePageId);
  }
  resetHistory();
}

async function renderPdfPageToImage(page, targetWidth, targetHeight, background='#ffffff'){
  if(!page) return null;
  const safeWidth = Math.max(1, Math.round(targetWidth));
  const safeHeight = Math.max(1, Math.round(targetHeight));
  let viewport = page.getViewport({ scale: 1 });
  let scale = Math.min(
    safeWidth / (viewport.width || safeWidth),
    safeHeight / (viewport.height || safeHeight)
  );
  if(!Number.isFinite(scale) || scale <= 0){
    scale = 1;
  }
  viewport = page.getViewport({ scale });
  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = Math.max(1, Math.round(viewport.width));
  renderCanvas.height = Math.max(1, Math.round(viewport.height));
  const renderCtx = renderCanvas.getContext('2d', { alpha:false });
  if(!renderCtx){
    throw new Error('No se ha podido preparar el lienzo para el PDF.');
  }
  renderCtx.fillStyle = '#ffffff';
  renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
  await page.render({ canvasContext: renderCtx, viewport }).promise;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = safeWidth;
  outputCanvas.height = safeHeight;
  const outputCtx = outputCanvas.getContext('2d', { alpha:false });
  if(!outputCtx){
    throw new Error('No se ha podido inicializar el lienzo de salida.');
  }
  outputCtx.fillStyle = typeof background === 'string' ? background : '#ffffff';
  outputCtx.fillRect(0, 0, safeWidth, safeHeight);
  const dx = Math.floor((safeWidth - renderCanvas.width) / 2);
  const dy = Math.floor((safeHeight - renderCanvas.height) / 2);
  outputCtx.drawImage(renderCanvas, dx, dy, renderCanvas.width, renderCanvas.height);
  return outputCanvas.toDataURL('image/png');
}

async function loadPdfFromFile(file){
  if(!file) return;
  if(!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function'){
    throw new Error('No se ha podido cargar el visor de PDF.');
  }
  expandCanvasToViewport(true);
  syncCanvasResolution({ preserve:true });
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const fallbackWidth = Math.round((canvas.clientWidth || board.clientWidth || 1280) * dpr);
  const fallbackHeight = Math.round((canvas.clientHeight || board.clientHeight || desiredCanvasHeight()) * dpr);
  const targetWidth = Math.max(1, canvas.width || fallbackWidth);
  const targetHeight = Math.max(1, canvas.height || fallbackHeight);
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  let pdf = null;
  try{
    pdf = await loadingTask.promise;
    if(!pdf || !pdf.numPages){
      throw new Error('El PDF no contiene páginas.');
    }
    const images = [];
    for(let pageNum = 1; pageNum <= pdf.numPages; pageNum++){
      const page = await pdf.getPage(pageNum);
      const dataUrl = await renderPdfPageToImage(page, targetWidth, targetHeight);
      if(dataUrl) images.push(dataUrl);
      if(typeof page.cleanup === 'function') page.cleanup();
    }
    if(!images.length){
      throw new Error('No se pudieron procesar las páginas del PDF.');
    }
    applyImportedPdfPages(images, { background:'#ffffff' });
  } finally {
    try{
      if(loadingTask && typeof loadingTask.destroy === 'function'){
        await loadingTask.destroy();
      }
    }catch(e){}
    if(pdf && typeof pdf.cleanup === 'function'){
      try{ pdf.cleanup(); }catch(e){}
    }
  }
}

function broadcastPages(){
  if(!isHost) return;
  const payload = {
    type:'pages-sync',
    pages: serializePages({ refreshActive:true }),
    active: activePageId
  };
  broadcast(payload);
}

function broadcastPageChange(id){
  if(!isHost) return;
  if(!id) return;
  broadcast({ type:'page-change', id });
}

function syncPagesFromHost(list, activeId){
  if(!Array.isArray(list) || list.length === 0){
    pageOrderCounter = 0;
    pages.length = 0;
    const fallback = createPage({ bg: currentBg });
    pages.push(fallback);
    activePageId = fallback.id;
    applyPageToCanvas(fallback);
    renderPageThumbnails();
    return;
  }
  pageOrderCounter = 0;
  pages.length = 0;
  list.forEach(item=>{
    const page = createPage({
      id: item.id || generatePageId(),
      bg: item.bg || '#ffffff',
      image: item.image || null,
      order: item.order ?? null
    });
    pages.push(page);
  });
  activePageId = activeId && pages.find(p=> p.id === activeId) ? activeId : (pages[0]?.id ?? null);
  applyPageToCanvas(getActivePage());
  renderPageThumbnails();
}

resetPages({ bg: currentBg, preserveCanvas:true });
resetHistory();

applyHostButtonState(hostButtonState);
applyJoinButtonState(joinButtonState);
updateCodeInputVisibility();
updateShareLinkUi();
updateViewToggle();
setCurrentTool('pen', { silent:true });
updateToolSelection();
updateHistoryUi();

function clamp(value, min, max){
  const n = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, n));
}

function toggleHidden(elements, hidden){
  elements.forEach(el=>{
    if(!el) return;
    el.classList.toggle('hidden', hidden);
    if(hidden && typeof el.contains === 'function' && el.contains(document.activeElement)){
      try{ document.activeElement.blur(); }catch(e){}
    }
  });
}

function sectionHasVisibleContent(section){
  if(!section) return false;
  return Array.from(section.children).some(child=>{
    if(!(child instanceof HTMLElement)) return false;
    if(child.classList.contains('hidden')) return false;
    return true;
  });
}

function refreshSectionButtons(){
  sectionButtons.forEach(btn=>{
    const id = btn.dataset.target;
    const section = sectionsMap.get(id);
    const visible = sectionHasVisibleContent(section);
    btn.classList.toggle('hidden', !visible);
    const isActive = visible && id === activeSection;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  toolbarSections.forEach(section=>{
    const id = section.dataset.section;
    const isActive = id === activeSection;
    const hasContent = sectionHasVisibleContent(section);
    section.setAttribute('aria-hidden', isActive && hasContent ? 'false' : 'true');
  });
}

function setActiveSection(id, {force=false} = {}){
  if(!toolbarControls || !sectionsMap.has(id)) return;
  if(!force && id === activeSection) { refreshSectionButtons(); return; }
  activeSection = id;
  toolbarControls.dataset.active = id;
  refreshSectionButtons();
}

function ensureActiveSectionVisible(){
  const current = sectionsMap.get(activeSection);
  if(sectionHasVisibleContent(current)) return;
  const fallback = sectionButtons.find(btn=> !btn.classList.contains('hidden'));
  if(fallback){
    setActiveSection(fallback.dataset.target, {force:true});
  }
}

sectionButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(btn.classList.contains('hidden')) return;
    setActiveSection(btn.dataset.target, {force:true});
  });
});

setActiveSection(activeSection, {force:true});
ensureActiveSectionVisible();

function getPenSize(){
  const raw = parseFloat(sizeInput?.value);
  return clamp(Number.isFinite(raw) ? raw : 4, 1, 50);
}

function getEraserSize(){
  const raw = parseFloat(eraserSizeInput?.value);
  return clamp(Number.isFinite(raw) ? raw : 20, 1, 100);
}

function pointerClientPosition(e){
  if(!e) return null;
  const source = e.touches?.[0] || e.changedTouches?.[0] || e;
  const x = source?.clientX;
  const y = source?.clientY;
  if(Number.isFinite(x) && Number.isFinite(y)) return {x, y};
  return null;
}

function hideEraserCursor(){
  if(!eraserCursorEl) return;
  eraserCursorEl.style.left = '-1000px';
  eraserCursorEl.style.top = '-1000px';
}

function updateEraserCursorSize(){
  if(!eraserCursorEl || !erasing) return;
  const scale = canvasScale || 1;
  const diameter = Math.max(6, getEraserSize() * scale);
  eraserCursorEl.style.width = `${diameter}px`;
  eraserCursorEl.style.height = `${diameter}px`;
  const border = Math.max(1, Math.min(4, Math.round(diameter * 0.15)));
  eraserCursorEl.style.borderWidth = `${border}px`;
}

function updateEraserCursorFromEvent(e){
  if(!eraserCursorEl){
    return;
  }
  if(!erasing){
    hideEraserCursor();
    if(canvas) canvas.classList.remove('erase-mode');
    return;
  }
  const pos = pointerClientPosition(e);
  if(!pos){
    hideEraserCursor();
    return;
  }
  updateEraserCursorSize();
  if(canvas) canvas.classList.add('erase-mode');
  eraserCursorEl.style.left = `${pos.x}px`;
  eraserCursorEl.style.top = `${pos.y}px`;
}

function drawingLocked(){
  if(readonlyToggle?.checked) return true;
  if(!isHost && remoteLock) return true;
  return false;
}

function updateEraserLabel(){
  if(eraserBtn) eraserBtn.textContent = erasing ? 'Borrador (on)' : 'Borrador';
  if(canvas) canvas.classList.toggle('erase-mode', erasing);
  if(erasing) updateEraserCursorSize();
  else hideEraserCursor();
}

function setEraserMode(active){
  const desired = !!active;
  if(desired === erasing){
    updateEraserLabel();
    updateToolSelection();
    return;
  }
  erasing = desired;
  updateEraserLabel();
  updateToolSelection();
}

function updateLockToggle(){
  if(!lockToggle) return;
  lockToggle.disabled = !isHost;
  lockToggle.checked = isHost ? guestLock : remoteLock;
  lockToggle.title = isHost ? 'Impide que los invitados dibujen o borren la pizarra' : 'Solo el anfitrión puede cambiar esta opción';
}

function updateGuestControls(){
  const disable = !isHost && remoteLock;
  guestControls.forEach(el=>{
    if(el) el.disabled = disable;
  });
  if(disable){
    drawing = false;
    if(erasing) setEraserMode(false);
  }
}

function updateBackgroundInput(){
  if(!bgInput) return;
  const disable = !isHost && !!(conn && conn.open);
  bgInput.disabled = disable;
  if(disable) bgInput.value = currentBg;
}

function updateRoleUi(){
  const guestConnected = !isHost && !!(conn && conn.open);
  toggleHidden(hostOnlyEls, guestConnected);
  const hideEdit = guestConnected && remoteLock;
  toggleHidden(editControlEls, hideEdit);
  if(joinBtn){
    const hideJoin = isHost;
    joinBtn.classList.toggle('hidden', hideJoin);
  }
  if(headerEl) headerEl.dataset.role = isHost ? 'host' : 'guest';
  if(roleLabel){
    roleLabel.textContent = isHost ? 'Modo (anfitrión):' : 'Modo (invitado):';
  }
  if(!isHost) setPagePanelOpen(false);
  refreshSectionButtons();
  ensureActiveSectionVisible();
}

function currentMenuCollapsed(){
  if(manualMenuState !== null) return manualMenuState;
  return menuQuery.matches;
}

function applyMenuState(){
  const collapsed = currentMenuCollapsed();
  if(headerEl) headerEl.dataset.collapsed = collapsed ? 'true' : 'false';
  if(menuToggleBtn){
    menuToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    menuToggleBtn.setAttribute('aria-label', collapsed ? 'Mostrar menú de herramientas' : 'Ocultar menú de herramientas');
    menuToggleBtn.textContent = collapsed ? 'Mostrar menú' : 'Ocultar menú';
  }
  if(toolbarControls){
    toolbarControls.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if(collapsed) toolbarControls.setAttribute('inert', '');
    else toolbarControls.removeAttribute('inert');
  }
  if(toolbarNav){
    toolbarNav.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if(collapsed) toolbarNav.setAttribute('inert', '');
    else toolbarNav.removeAttribute('inert');
  }
  expandCanvasToViewport(isHost);
  adjustGuestView();
}

menuToggleBtn?.addEventListener('click', ()=>{
  const collapsed = headerEl?.dataset.collapsed === 'true';
  manualMenuState = collapsed ? false : true;
  applyMenuState();
});

const handleMenuQueryChange = (e)=>{
  if(e && !e.matches){
    manualMenuState = null;
  }
  applyMenuState();
};

if(typeof menuQuery.addEventListener === 'function'){
  menuQuery.addEventListener('change', handleMenuQueryChange);
} else if(typeof menuQuery.addListener === 'function'){
  menuQuery.addListener(handleMenuQueryChange);
}

applyMenuState();

function refreshUi(){
  updateLockToggle();
  updateGuestControls();
  updateBackgroundInput();
  updateEraserLabel();
  updateCodeInputVisibility();
  if(!isHost){
    if(conn && conn.open){
      const locked = remoteLock;
      setStatus(locked ? 'Sin edición' : 'conectado', 'connected');
    } else {
      setStatus('sin conexión', 'disconnected');
    }
  } else {
    const count = guests.size;
    if(count > 0){
      setStatus(`conectados: ${count}`, 'connected');
    } else {
      setStatus('esperando conexiones', 'connected');
    }
  }
  updateRoleUi();
  adjustGuestView();
  updateShareLinkUi();
}

function adjustGuestView(){
  const { width: viewportWidth, height: rawHeight } = viewportInfo();
  const baseHeight = Number.isFinite(rawHeight) ? rawHeight : window.innerHeight;
  const headerH = headerHeight();
  const availableHeight = Math.max(200, baseHeight - headerH);
  const availableWidth = viewportWidth || window.innerWidth;
  if(isHost){
    canvasScale = 1;
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
    if(boardExpanded){
      board.style.height = `${availableHeight}px`;
      board.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      board.style.height = '';
      board.style.overflow = 'auto';
      document.body.style.overflow = '';
    }
    return;
  }
  canvas.style.transform = '';
  canvas.style.transformOrigin = '';
  const targetHeight = cssHeight || canvas.offsetHeight || availableHeight;
  const targetWidth = canvas.offsetWidth || availableWidth || canvas.clientWidth;
  let scale = 1;
  if(targetWidth > 0){
    const widthScale = availableWidth / targetWidth;
    if(Number.isFinite(widthScale) && widthScale > 0){
      scale = Math.min(1, widthScale);
    }
  }
  if(!Number.isFinite(scale) || scale <= 0) scale = 1;
  canvasScale = scale;
  if(scale < 1){
    canvas.style.transform = `scale(${scale})`;
    canvas.style.transformOrigin = 'top left';
  } else {
    canvas.style.transform = '';
  }
  board.style.height = `${availableHeight}px`;
  board.style.overflow = 'auto';
  document.body.style.overflow = boardExpanded ? 'hidden' : '';
  if(erasing) updateEraserCursorSize();
}

// ===== Dibujo local y sincronización =====
function drawSegment(seg){
  if(!seg) return;
  ctx.save();
  if(seg.mode === 'erase'){
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else if(seg.mode === 'highlight'){
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
  if(Number.isFinite(seg.cx) && Number.isFinite(seg.cy)){
    ctx.quadraticCurveTo(seg.cx, seg.cy, seg.x1, seg.y1);
  } else {
    ctx.lineTo(seg.x1, seg.y1);
  }
  ctx.stroke();
  ctx.restore();
}

function captureCanvasState(){
  try{
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }catch(err){
    console.warn('No se pudo capturar el estado actual del lienzo.', err);
    return null;
  }
}

function restoreCanvasState(state){
  if(!state) return;
  try{
    ctx.putImageData(state, 0, 0);
  }catch(err){
    console.warn('No se pudo restaurar el estado del lienzo.', err);
  }
}
// Puntero/Toque
function pointerXY(e){
  const rect = canvas.getBoundingClientRect();
  const scale = canvasScale || 1;
  const clientX = (e.clientX ?? e.touches?.[0]?.clientX ?? 0);
  const clientY = (e.clientY ?? e.touches?.[0]?.clientY ?? 0);
  const x = (clientX - rect.left) / scale;
  const y = (clientY - rect.top) / scale;
  return {x,y};
}
function down(e){
  finalizeActiveImageIfPresent();
  updateEraserCursorFromEvent(e);
  const pointerId = e?.pointerId ?? 'mouse';
  const rightButton = e?.button === 2 || (e?.pointerType === 'mouse' && (e?.buttons & 2));
  if(rightButton && tempErasePointerId === null){
    eraseModeBeforeOverride = erasing;
    if(!erasing) setEraserMode(true);
    tempErasePointerId = pointerId;
  }
  if(drawingLocked()){
    if(tempErasePointerId === pointerId){
      setEraserMode(eraseModeBeforeOverride);
      tempErasePointerId = null;
    }
    return;
  }
  if(canvas?.setPointerCapture && e?.pointerId !== undefined){
    try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
  }
  const pos = pointerXY(e);
  if(!pos) return;
  beginHistoryAction();
  const tool = effectiveTool();
  if(isShapeTool(tool)){
    shapeStart = pos;
    shapeSnapshot = captureCanvasState();
    drawingShape = true;
    drawing = false;
  } else {
    drawing = true;
    drawingShape = false;
    lastPoint = pos;
    lastMidpoint = pos;
  }
  e.preventDefault();
}
function move(e){
  updateEraserCursorFromEvent(e);
  if(drawingShape){
    if(!shapeStart) return;
    const pos = pointerXY(e);
    if(!pos) return;
    restoreCanvasState(shapeSnapshot);
    const tool = effectiveTool();
    const color = currentStrokeColor();
    const size = getPenSize();
    const alpha = tool === 'highlight' ? HIGHLIGHT_ALPHA : undefined;
    drawShapeOnCanvas({ shape: tool, start: shapeStart, end: pos, color, size, alpha });
    e.preventDefault();
    return;
  }
  if(!drawing) return;
  if(!isHost && remoteLock){ drawing = false; return; }
  const p = pointerXY(e);
  const tool = effectiveTool();
  const color = erasing ? '#000000' : currentStrokeColor();
  const size = erasing ? getEraserSize() : getPenSize();
  const mid = {
    x: (lastPoint.x + p.x) / 2,
    y: (lastPoint.y + p.y) / 2
  };
  const segment = {
    x0: lastMidpoint?.x ?? lastPoint.x,
    y0: lastMidpoint?.y ?? lastPoint.y,
    cx: lastPoint.x,
    cy: lastPoint.y,
    x1: mid.x,
    y1: mid.y,
    color,
    size,
    mode: erasing ? 'erase' : (tool === 'highlight' ? 'highlight' : 'draw'),
    alpha: tool === 'highlight' ? HIGHLIGHT_ALPHA : undefined
  };
  drawSegment(segment);
  emitStroke(segment);
  lastPoint = p;
  lastMidpoint = mid;
  e.preventDefault();
}

function up(e){
  updateEraserCursorFromEvent(e);
  const tool = effectiveTool();
  if(drawingShape){
    const start = shapeStart;
    const pos = e ? pointerXY(e) : start;
    restoreCanvasState(shapeSnapshot);
    const color = currentStrokeColor();
    const size = getPenSize();
    drawShapeOnCanvas({ shape: tool, start, end: pos, color, size });
    drawingShape = false;
    shapeStart = null;
    shapeSnapshot = null;
    if(canvas?.releasePointerCapture && e?.pointerId !== undefined){
      try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
    }
    commitHistoryAction();
    emitShape({ shape: tool, start, end: pos, color, size });
  } else if(drawing){
    const color = erasing ? '#000000' : currentStrokeColor();
    const size = erasing ? getEraserSize() : getPenSize();
    const endPoint = e ? pointerXY(e) : lastPoint;
    if(lastPoint && lastMidpoint && endPoint){
      const segment = {
        x0: lastMidpoint.x,
        y0: lastMidpoint.y,
        cx: lastPoint.x,
        cy: lastPoint.y,
        x1: endPoint.x,
        y1: endPoint.y,
        color,
        size,
        mode: erasing ? 'erase' : (tool === 'highlight' ? 'highlight' : 'draw'),
        alpha: tool === 'highlight' ? HIGHLIGHT_ALPHA : undefined
      };
      drawSegment(segment);
      emitStroke(segment);
    }
    drawing=false;
    lastPoint=null;
    lastMidpoint=null;
    if(canvas?.releasePointerCapture && e?.pointerId !== undefined){
      try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
    }
    commitHistoryAction();
  }
  if(canvas?.releasePointerCapture && e?.pointerId !== undefined){
    try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
  }
  const pointerId = e?.pointerId ?? 'mouse';
  if(tempErasePointerId !== null && pointerId === tempErasePointerId){
    setEraserMode(eraseModeBeforeOverride);
    tempErasePointerId = null;
  }
  if(e?.type === 'pointerleave'){
    hideEraserCursor();
  }
  if(isHost) schedulePageSnapshot();
}

function handlePointerLeave(e){
  hideEraserCursor();
  if(drawing || drawingShape){
    up(e);
  } else if(canvas){
    canvas.classList.toggle('erase-mode', erasing);
  }
  const pointerId = e?.pointerId ?? 'mouse';
  if(tempErasePointerId !== null && pointerId === tempErasePointerId){
    setEraserMode(eraseModeBeforeOverride);
    tempErasePointerId = null;
  }
}

function clearCanvas(){
  cancelActiveImage();
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.restore();
  if(isHost) schedulePageSnapshot();
}

canvas.addEventListener('pointerdown', down);
canvas.addEventListener('pointerenter', updateEraserCursorFromEvent);
canvas.addEventListener('pointermove', move);
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointerleave', handlePointerLeave);
canvas.addEventListener('pointercancel', handlePointerLeave);
canvas.addEventListener('touchstart', e=>e.preventDefault(), {passive:false});
canvas.addEventListener('contextmenu', e=>e.preventDefault());

sizeInput?.addEventListener('change', ()=>{ sizeInput.value = String(getPenSize()); });
eraserSizeInput?.addEventListener('change', ()=>{ 
  eraserSizeInput.value = String(getEraserSize());
  updateEraserCursorSize();
});

function updateShareLinkUi(){
  if(qrUrl){
    const available = !!shareUrl;
    qrUrl.textContent = available ? shareUrl : '—';
    qrUrl.title = available ? 'Haz clic para copiar' : 'Enlace no disponible';
    qrUrl.classList.toggle('disabled', !available);
    if(available) qrUrl.setAttribute('tabindex', '0');
    else qrUrl.setAttribute('tabindex', '-1');
    qrUrl.setAttribute('aria-disabled', available ? 'false' : 'true');
  }
  if(copyUrlBtn){
    copyUrlBtn.disabled = !shareUrl;
  }
  if(!shareUrl){
    hideCopyFeedback();
  }
}

function hideCopyFeedback(){
  if(copyFeedbackTimeout){
    clearTimeout(copyFeedbackTimeout);
    copyFeedbackTimeout = null;
  }
  if(!copyUrlFeedback) return;
  copyUrlFeedback.classList.add('hidden');
  copyUrlFeedback.classList.remove('error');
}

function showCopyFeedback(message, { error=false } = {}){
  if(!copyUrlFeedback) return;
  hideCopyFeedback();
  copyUrlFeedback.textContent = message;
  copyUrlFeedback.classList.toggle('error', !!error);
  copyUrlFeedback.classList.remove('hidden');
  copyFeedbackTimeout = window.setTimeout(()=> hideCopyFeedback(), error ? 2400 : 1600);
}

async function copyShareLink(){
  if(!shareUrl){
    showCopyFeedback('No hay enlace disponible', { error:true });
    return;
  }
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(shareUrl);
    } else {
      const temp = document.createElement('textarea');
      temp.value = shareUrl;
      temp.setAttribute('readonly', '');
      temp.style.position = 'absolute';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(temp);
      if(!ok) throw new Error('Clipboard copy failed');
    }
    showCopyFeedback('Enlace copiado');
  }catch(err){
    console.error(err);
    showCopyFeedback('No se pudo copiar', { error:true });
  }
}

function ensureQr(){
  if(!qrInstance){
    qrInstance = new QRCode(document.getElementById('qr'), { width:240, height:240, correctLevel: QRCode.CorrectLevel.M });
  }
  return qrInstance;
}

function showQr(){
  if(!shareUrl){
    alert('Activa el modo anfitrión para obtener un código y enlace de conexión.');
    return;
  }
  if(!qrOverlay || !qrUrl){
    console.warn('No se pudo mostrar el QR porque falta el contenedor del enlace.');
    return;
  }
  ensureQr().makeCode(shareUrl);
  updateShareLinkUi();
  hideCopyFeedback();
  qrCodeText.textContent = sanitizeCode(codeInput?.value) || '—';
  qrOverlay.style.display = 'flex';
  setTimeout(()=>{
    if(qrOverlay?.style.display === 'flex' && qrUrl && !qrUrl.classList.contains('disabled')){
      qrUrl.focus();
    }
  }, 60);
}

function hideQr(){
  if(qrOverlay) qrOverlay.style.display = 'none';
  hideCopyFeedback();
}

qrBtn?.addEventListener('click', showQr);
qrClose?.addEventListener('click', hideQr);
qrOverlay?.addEventListener('click', e=>{ if(e.target === qrOverlay) hideQr(); });
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') hideQr(); });

copyUrlBtn?.addEventListener('click', copyShareLink);
qrUrl?.addEventListener('click', ()=>{
  if(qrUrl.classList.contains('disabled')) return;
  copyShareLink();
});
qrUrl?.addEventListener('keydown', e=>{
  if(e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  e.preventDefault();
  if(qrUrl.classList.contains('disabled')) return;
  copyShareLink();
});

viewToggleBtn?.addEventListener('click', ()=>{
  if(boardExpanded){
    exitBoardFullscreen();
  } else {
    enterBoardFullscreen();
  }
});

toolButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(btn.disabled) return;
    setCurrentTool(btn.dataset.tool);
  });
});

undoBtn?.addEventListener('click', ()=>{
  if(undoBtn.disabled) return;
  performUndo();
});

redoBtn?.addEventListener('click', ()=>{
  if(redoBtn.disabled) return;
  performRedo();
});

insertImageBtn?.addEventListener('click', ()=>{
  if(!isHost){
    alert('Solo el anfitrión puede insertar imágenes.');
    return;
  }
  imageInput?.click();
});

imageInput?.addEventListener('change', event=>{
  const input = event.target;
  const file = input?.files && input.files[0] ? input.files[0] : null;
  if(!file){
    if(input) input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = ()=>{
    placeImageOnCanvas(reader.result);
  };
  reader.onerror = ()=> alert('No se pudo leer la imagen seleccionada.');
  reader.readAsDataURL(file);
  if(input) input.value = '';
});

pageToggleBtn?.addEventListener('click', ()=>{
  setPagePanelOpen(!pagePanelOpen);
});

pageCloseBtn?.addEventListener('click', ()=>{
  setPagePanelOpen(false);
});

pageAddBtn?.addEventListener('click', ()=>{
  addNewPage();
});

pagePrevBtn?.addEventListener('click', ()=>{
  stepPage(-1);
});

pageNextBtn?.addEventListener('click', ()=>{
  stepPage(1);
});

pageThumbnailsEl?.addEventListener('click', e=>{
  const deleteBtn = e.target.closest('.page-thumb-delete');
  if(deleteBtn){
    const id = deleteBtn.dataset.pageId;
    if(id) removePage(id);
    return;
  }
  const thumb = e.target.closest('.page-thumb');
  if(thumb){
    const id = thumb.dataset.pageId;
    if(id) setActivePage(id);
  }
});

pagePanelHead?.addEventListener('pointerdown', startPagePanelDrag);
document.addEventListener('pointermove', updatePagePanelDrag);
document.addEventListener('pointerup', endPagePanelDrag);
document.addEventListener('pointercancel', endPagePanelDrag);

document.addEventListener('keydown', e=>{
  if(e.key !== 'Escape') return;
  if(pagePanelOpen){
    setPagePanelOpen(false);
    return;
  }
  if(boardExpanded){
    if(qrOverlay && qrOverlay.style.display === 'flex') return;
    exitBoardFullscreen();
  }
});

updateEraserLabel();

eraserBtn?.addEventListener('click', ()=>{
  setEraserMode(!erasing);
});

function emitBg(color){
  if(!isHost) return;
  broadcast({type:'bg', color});
}

function applyBackground(color, propagate=true){
  const target = typeof color === 'string' ? color : currentBg;
  currentBg = target;
  canvas.style.background = target;
  board.style.background = target;
  if(bgInput) bgInput.value = target;
  const activePage = getActivePage();
  if(activePage){
    activePage.bg = target;
  }
  if(propagate) emitBg(target);
  if(isHost) schedulePageSnapshot();
}

applyBackground(currentBg, false);
bgInput?.addEventListener('input', e=>{
  if(!isHost){
    e.target.value = currentBg;
    return;
  }
  applyBackground(e.target.value);
});

lockToggle?.addEventListener('change', ()=>{
  if(!isHost){
    lockToggle.checked = remoteLock;
    return;
  }
  guestLock = lockToggle.checked;
  refreshUi();
  broadcast({type:'lock', value: guestLock});
});

refreshUi();
if(sizeInput) sizeInput.value = String(getPenSize());
if(eraserSizeInput) eraserSizeInput.value = String(getEraserSize());
if(codeInput){
  codeInput.addEventListener('input', ()=>{
    const sanitized = sanitizeCode(codeInput.value);
    codeInput.value = sanitized;
  });
  codeInput.addEventListener('change', ()=>{
    codeInput.value = sanitizeCode(codeInput.value);
  });
}
function handleViewportResize(force=false){
  expandCanvasToViewport(force || isHost);
  adjustGuestView();
  ensurePagePanelWithinViewport();
}

function scheduleViewportAdjust({ force=false, debounce=true } = {}){
  handleViewportResize(force);
  if(debounce){
    if(viewportAdjustFrame !== null){
      cancelAnimationFrame(viewportAdjustFrame);
      viewportAdjustFrame = null;
    }
    viewportAdjustFrame = requestAnimationFrame(()=>{
      viewportAdjustFrame = null;
      handleViewportResize(force);
    });
    if(viewportAdjustTimeout !== null){
      clearTimeout(viewportAdjustTimeout);
      viewportAdjustTimeout = null;
    }
    viewportAdjustTimeout = window.setTimeout(()=>{
      viewportAdjustTimeout = null;
      handleViewportResize(true);
    }, 260);
  }
  if(!isHost && conn && conn.open){
    const { width, height } = viewportInfo();
    if(Number.isFinite(width) && Number.isFinite(height)){
      const signature = `${width}x${height}`;
      const changed = signature !== lastGuestViewportSignature;
      if(changed || force){
        lastGuestViewportSignature = signature;
        requestStateRefresh({ immediate: !debounce });
      }
    } else if(force){
      requestStateRefresh({ immediate: !debounce });
    }
  }
}

function requestStateRefresh({ immediate=false } = {}){
  if(isHost) return;
  if(!conn || !conn.open) return;
  if(immediate){
    cssHeight = null;
    cssWidth = null;
  }
  const send = ()=>{
    if(!conn || !conn.open) return;
    try{ conn.send({type:'viewport-info', width: viewportInfo().width, height: viewportInfo().height }); }catch(err){}
    cssHeight = null;
    cssWidth = null;
    try{ conn.send({type:'request-state'}); }catch(err){ console.warn('No se pudo solicitar el estado al anfitrión.', err); }
  };
  if(immediate){
    send();
    return;
  }
  if(stateRequestTimeout !== null) return;
  stateRequestTimeout = window.setTimeout(()=>{
    stateRequestTimeout = null;
    send();
  }, 160);
}

window.addEventListener('resize', ()=> scheduleViewportAdjust({ force:false }));

if(window.visualViewport){
  const visualViewportHandler = ()=>{
    scheduleViewportAdjust({ force:true });
  };
  window.visualViewport.addEventListener('resize', visualViewportHandler);
  window.visualViewport.addEventListener('scroll', visualViewportHandler);
}

window.addEventListener('orientationchange', ()=>{
  scheduleViewportAdjust({ force:true });
  setTimeout(()=> scheduleViewportAdjust({ force:true, debounce:false }), 320);
});

function canvasSnapshot(){
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const offCtx = off.getContext('2d');
  offCtx.fillStyle = currentBg;
  offCtx.fillRect(0,0,off.width,off.height);
  offCtx.drawImage(canvas,0,0);
  return off.toDataURL('image/png');
}

function applySnapshot(dataUrl){
  if(!dataUrl) return Promise.resolve();
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{
      syncCanvasResolution({preserve:false});
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      ctx.restore();
      if(isHost){
        saveCurrentPageState();
        if(pagePanelOpen) renderPageThumbnails({ force:true });
      } else {
        renderPageThumbnails({ force:true });
      }
      resolve(true);
    };
    img.onerror = ()=>{
      console.warn('No se pudo aplicar la instantánea recibida.');
      resolve(false);
    };
    img.src = dataUrl;
  });
}

function sendStateTo(connection){
  try{
    const pagesPayload = serializePages({ refreshActive:true });
    const width = Math.round(canvas.clientWidth || board.clientWidth || window.innerWidth || 0);
    const height = typeof cssHeight === 'number' ? cssHeight : desiredCanvasHeight();
    const activePage = getActivePage();
    connection.send({
      type:'state',
      h: height,
      w: width,
      bg: currentBg,
      lock: guestLock,
      pages: pagesPayload,
      activePage: activePageId,
      image: activePage?.image || canvasSnapshot()
    });
  }catch(e){}
}

function handleIncoming(msg, source){
  if(!msg || typeof msg !== 'object') return;
  switch(msg.type){
    case 'stroke': {
      finalizeActiveImageIfPresent();
      const s = msg.s;
      if(!s) break;
      drawSegment(s);
      if(isHost) broadcast(msg, source?.peer);
      break;
    }
    case 'clear':
      cancelActiveImage();
      clearCanvas();
      if(isHost) broadcast(msg, source?.peer);
      break;
    case 'bg':
      finalizeActiveImageIfPresent();
      if(typeof msg.color === 'string'){
        applyBackground(msg.color, false);
      }
      if(isHost) broadcast(msg, source?.peer);
      break;
    case 'shape': {
      finalizeActiveImageIfPresent();
      const start = parsePoint(msg.start);
      const end = parsePoint(msg.end);
      if(!start || !end || !msg.shape) break;
      if(isHost) beginHistoryAction();
      drawShapeOnCanvas({
        shape: msg.shape,
        start,
        end,
        color: msg.color || '#000000',
        size: Number.isFinite(msg.size) ? msg.size : getPenSize()
      });
      if(!isHost){
        renderPageThumbnails({ force:true });
      }
      if(isHost){
        commitHistoryAction();
        schedulePageSnapshot();
        broadcast(msg, source?.peer);
      }
      break;
    }
    case 'image':
      finalizeActiveImageIfPresent();
      if(typeof msg.dataUrl === 'string'){
        if(isHost) beginHistoryAction();
        drawImageFromDataUrl({
          dataUrl: msg.dataUrl,
          x: Number.isFinite(msg.x) ? msg.x : 0,
          y: Number.isFinite(msg.y) ? msg.y : 0,
          width: Number.isFinite(msg.width) ? msg.width : undefined,
          height: Number.isFinite(msg.height) ? msg.height : undefined
        }).then(changed=>{
          if(isHost){
            if(changed){
              commitHistoryAction();
              schedulePageSnapshot();
              broadcast(msg, source?.peer);
            } else {
              historyActionStarted = false;
              updateHistoryUi();
            }
          } else if(changed){
            renderPageThumbnails({ force:true });
          }
        });
      }
      break;
    case 'canvas':
      finalizeActiveImageIfPresent();
      if(!isHost && typeof msg.image === 'string'){
        applySnapshot(msg.image);
        if(typeof msg.bg === 'string') applyBackground(msg.bg, false);
      }
      break;
    case 'lock':
      if(typeof msg.value === 'boolean'){
        if(isHost){
          if(source){
            try{ source.send({type:'lock', value: guestLock}); }catch(e){}
          }
        } else {
          remoteLock = msg.value;
          refreshUi();
        }
      }
      break;
    case 'state':
      if(!isHost){
        let shouldRefresh = false;
        if(Array.isArray(msg.pages) && msg.pages.length){
          syncPagesFromHost(msg.pages, msg.activePage || msg.active);
          shouldRefresh = true;
        } else {
          if(msg.bg) applyBackground(msg.bg, false);
          if(msg.image) applySnapshot(msg.image);
          shouldRefresh = true;
        }
        if(typeof msg.lock === 'boolean'){
          remoteLock = msg.lock;
          shouldRefresh = true;
        }
        if(Number.isFinite(msg.w)){
          cssWidth = msg.w;
          applyCanvasWidth();
          shouldRefresh = true;
        }
        if(typeof msg.h === 'number'){
          cssHeight = msg.h;
          setCanvasCssHeight(cssHeight);
          shouldRefresh = true;
        }
        if(shouldRefresh){
          refreshUi();
          const { width, height } = viewportInfo();
          if(Number.isFinite(width) && Number.isFinite(height)){
            lastGuestViewportSignature = `${width}x${height}`;
          }
        }
      }
      break;
    case 'viewport':
      if(!isHost){
        if(Number.isFinite(msg.w)){
          cssWidth = msg.w;
          applyCanvasWidth();
        }
        if(typeof msg.h === 'number'){
          cssHeight = msg.h;
          setCanvasCssHeight(cssHeight);
        }
      }
      break;
    case 'pages-sync':
      if(!isHost){
        syncPagesFromHost(Array.isArray(msg.pages) ? msg.pages : [], msg.active);
      }
      break;
    case 'page-change':
      if(!isHost && msg?.id){
        setActivePage(msg.id, { broadcast:false, fromSync:true });
      }
      break;
case 'request-state':
case 'hello':
  if(isHost && source) sendStateTo(source);
  break;
case 'viewport-info':
  if(isHost && source){
    if(Number.isFinite(msg.width) && Number.isFinite(msg.height)){
      try{ source.send({type:'viewport', w: msg.width, h: msg.height}); }catch(e){}
    }
  }
  break;
    default:
      break;
  }
}

function broadcast(payload, excludeId=null){
  if(!isHost) return;
  guests.forEach((g,id)=>{
    if(excludeId && id === excludeId) return;
    try{ g.open && g.send(payload); }catch(e){}
  });
}

function emitClear(){
  if(isHost){ broadcast({type:'clear'}); }
  else if(conn && conn.open && !remoteLock){ conn.send({type:'clear'}); }
}

clearBtn?.addEventListener('click', ()=>{
  finalizeActiveImageIfPresent();
  beginHistoryAction();
  clearCanvas();
  commitHistoryAction();
  emitClear();
  if(isHost){
    broadcastCanvasSnapshot();
  }
});

openPdfBtn?.addEventListener('click', ()=>{
  if(!isHost){
    alert('Solo el anfitrión puede cargar PDFs.');
    return;
  }
  pdfInput?.click();
});

pdfInput?.addEventListener('change', async (event)=>{
  const input = event.target;
  const file = input?.files && input.files[0] ? input.files[0] : null;
  if(!file){
    if(input) input.value = '';
    return;
  }
  if(!isHost){
    alert('Solo el anfitrión puede cargar PDFs.');
    input.value = '';
    return;
  }
  if(!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function'){
    alert('No se ha podido cargar el visor de PDF.');
    input.value = '';
    return;
  }
  if(openPdfBtn){
    openPdfBtn.setAttribute('disabled', 'true');
    openPdfBtn.setAttribute('aria-busy', 'true');
  }
  try{
    await loadPdfFromFile(file);
  } catch(err){
    console.error(err);
    const message = err?.message || 'No se pudo abrir el PDF seleccionado.';
    alert(message);
  } finally {
    if(openPdfBtn){
      openPdfBtn.removeAttribute('disabled');
      openPdfBtn.removeAttribute('aria-busy');
    }
    input.value = '';
  }
});

savePdfBtn?.addEventListener('click', ()=>{
  if(!window.jspdf){
    alert('No se ha podido cargar jsPDF.');
    return;
  }
  if(!pages.length){
    alert('No hay páginas para exportar.');
    return;
  }
  const snapshots = pages.map(page=> ({
    id: page.id,
    bg: page.bg,
    data: snapshotForPage(page)
  }));
  const { jsPDF } = window.jspdf;
  const w = canvas.clientWidth || board.clientWidth || canvas.width || 1280;
  const h = canvas.clientHeight || board.clientHeight || canvas.height || 720;
  const orientation = w >= h ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit:'px', format:[w, h] });
  snapshots.forEach((snap, index)=>{
    const dataUrl = snap.data || blankPageDataUrl(snap.bg);
    if(index > 0){
      pdf.addPage([w, h], orientation);
    }
    pdf.addImage(dataUrl, 'PNG', 0, 0, w, h);
  });
  pdf.save(`pizarra-${new Date().toISOString().slice(0,10)}.pdf`);
});

function cleanupPeer({ hostState='idle', guestState='idle' } = {}){
  if(peer){
    try{ peer.destroy(); }catch(e){}
  }
  guests.forEach((c,id)=>{
    try{ c.close(); }catch(e){}
  });
  guests.clear();
  conn = null;
  peer = null;
  shareUrl = '';
  updateShareLinkUi();
  hideQr();
  isHost = false;
  guestLock = true;
  remoteLock = false;
  setEraserMode(false);
  cancelActiveImage();
  cssWidth = null;
  lastViewportHeight = null;
  lastViewportWidth = null;
  lastGuestViewportSignature = null;
  if(stateRequestTimeout !== null){
    clearTimeout(stateRequestTimeout);
    stateRequestTimeout = null;
  }
  applyCanvasWidth();
  applyHostButtonState(hostState);
  applyJoinButtonState(guestState);
  setStatus('sin conexión', 'disconnected');
  refreshUi();
  updateHistoryUi();
}

function buildShareUrl(code){
  try{
    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    return url.toString();
  }catch(e){
    return '';
  }
}

function updateStatusForGuests(){
  const count = guests.size;
  if(count > 0){
    setStatus(`conectados: ${count}`, 'connected');
  } else {
    setStatus('esperando conexiones', 'connected');
  }
}

function startHost({ force=false } = {}){
  const permitted = force || allowHostStart;
  allowHostStart = false;
  if(!permitted) return;
  cleanupPeer({ hostState:'idle', guestState:'idle' });
  const desired = sanitizeCode(codeInput?.value);
  const id = desired || rndCode();
  isHost = true;
  guestLock = true;
  remoteLock = false;
  resetHistory();
  refreshUi();
  applyHostButtonState('pending');
  if(codeInput) codeInput.value = id;
  expandCanvasToViewport(true);
  peer = new Peer(id, peerConfig);
  setStatus('creando sesión…', 'pending');
  peer.on('open', ()=>{
    applyHostButtonState('active');
    shareUrl = buildShareUrl(id);
    updateShareLinkUi();
    setStatus('esperando conexiones', 'connected');
  });
  peer.on('connection', c=>{
    guests.set(c.peer, c);
    updateStatusForGuests();
    c.on('close', ()=>{
      guests.delete(c.peer);
      updateStatusForGuests();
    });
    c.on('data', msg=> handleIncoming(msg, c));
    sendStateTo(c);
    try{ c.send({type:'hello'}); }catch(e){}
  });
  peer.on('disconnected', ()=>{
    cleanupPeer({ hostState:'error', guestState:'idle' });
    setStatus('desconectado', 'disconnected');
  });
  peer.on('error', e=>{
    console.error(e);
    cleanupPeer({ hostState:'error', guestState:'idle' });
    setStatus('error de conexión', 'error');
  });
}

function startGuest(code, { silent=false } = {}){
  const raw = code ?? codeInput?.value ?? '';
  const target = sanitizeCode(raw);
  if(!target){
    if(!silent) alert('Introduce un código válido.');
    return;
  }
  if(codeInput) codeInput.value = target;
  cleanupPeer({ hostState:'idle', guestState:'idle' });
  applyJoinButtonState('pending');
  isHost = false;
  guestLock = false;
  remoteLock = false;
  refreshUi();
  peer = new Peer(null, peerConfig);
  setStatus('conectando…', 'pending');
  peer.on('open', ()=>{
    conn = peer.connect(target, { reliable:true });
    refreshUi();
    conn.on('open', ()=>{
      setStatus('conectado', 'connected');
      applyJoinButtonState('active');
      refreshUi();
      try{ conn.send({type:'request-state'}); }catch(e){}
    });
    conn.on('data', msg=> handleIncoming(msg, conn));
    conn.on('close', ()=>{
      cleanupPeer({ hostState:'idle', guestState:'idle' });
      setStatus('cerrado', 'disconnected');
      cssWidth = null;
      applyCanvasWidth();
    });
    conn.on('error', err=>{
      console.error(err);
      cleanupPeer({ hostState:'idle', guestState:'error' });
      setStatus('error de conexión', 'error');
      cssWidth = null;
      applyCanvasWidth();
      if(!silent) alert('Error en la conexión con el anfitrión.');
    });
  });
  peer.on('error', e=>{
    console.error(e);
    cleanupPeer({ hostState:'idle', guestState:'error' });
    setStatus('error de conexión', 'error');
    if(!silent) alert('No se pudo crear la conexión.');
  });
}

hostBtn?.addEventListener('click', (event)=>{
  if(event && event.isTrusted === false) return;
  if(hostButtonState === 'pending') return;
  if(hostButtonState === 'active'){
    cleanupPeer();
    return;
  }
  allowHostStart = true;
  try{
    startHost();
  } finally {
    allowHostStart = false;
  }
});

joinBtn?.addEventListener('click', (event)=>{
  if(event && event.isTrusted === false) return;
  if(joinButtonState === 'pending') return;
  if(joinButtonState === 'active'){
    cleanupPeer();
    return;
  }
  startGuest();
});

function emitStroke(s){
  if(isHost){
    broadcast({type:'stroke', s});
  } else if(conn && conn.open && !remoteLock){
    conn.send({type:'stroke', s});
  }
}

const codeParam = (()=>{ try{ return new URL(window.location.href).searchParams.get('code'); }catch(e){ return null; }})();
if(codeParam){
  if(codeInput) codeInput.value = codeParam.toUpperCase();
  window.addEventListener('load', ()=> startGuest(codeParam, { silent:true }));
} else {
  window.addEventListener('load', ()=>{
    startHost({ force:true });
  });
}
function drawShapeOnCanvas({ shape, start, end, color, size, alpha }){
  if(!shape || !start || !end) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  if(Number.isFinite(alpha)) ctx.globalAlpha = alpha;
  ctx.strokeStyle = color || '#000000';
  ctx.lineWidth = Number.isFinite(size) ? size : getPenSize();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if(shape === 'line'){
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if(shape === 'rect'){
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    ctx.strokeRect(x, y, w, h);
  } else if(shape === 'ellipse'){
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function emitShape(payload){
  if(!payload || !isShapeTool(payload.shape)) return;
  const start = parsePoint(payload.start);
  const end = parsePoint(payload.end);
  if(!start || !end) return;
  const message = {
    type: 'shape',
    shape: payload.shape,
    start,
    end,
    color: payload.color,
    size: payload.size
  };
  if(isHost){
    broadcast(message);
  } else if(conn && conn.open && !remoteLock){
    try{ conn.send(message); }catch(e){}
  }
}

function emitImage(payload){
  if(!payload) return;
  const message = {
    type:'image',
    dataUrl: payload.dataUrl,
    x: payload.x,
    y: payload.y,
    width: payload.width,
    height: payload.height
  };
  if(isHost){
    broadcast(message);
  } else if(conn && conn.open && !remoteLock){
    try{ conn.send(message); }catch(e){}
  }
}

function drawImageFromDataUrl({ dataUrl, x=0, y=0, width, height }){
  return new Promise((resolve)=>{
    if(!dataUrl){
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = ()=>{
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      const w = Number.isFinite(width) ? width : img.width;
      const h = Number.isFinite(height) ? height : img.height;
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      resolve(true);
    };
    img.onerror = ()=>{
      console.warn('No se pudo cargar la imagen insertada.');
      resolve(false);
    };
    img.src = dataUrl;
  });
}

function hasActiveImageOverlay(){
  return !!(activeImageOverlay && activeImageState && activeImageState.imgEl);
}

function stopImageInteractionListeners(){
  if(imageDragState && activeImageOverlay?.releasePointerCapture && imageDragState.pointerId !== undefined){
    try{ activeImageOverlay.releasePointerCapture(imageDragState.pointerId); }catch(err){}
  }
  if(imageResizeState && activeImageOverlay?.releasePointerCapture && imageResizeState.pointerId !== undefined){
    try{ activeImageOverlay.releasePointerCapture(imageResizeState.pointerId); }catch(err){}
  }
  document.removeEventListener('pointermove', handleImageDragMove);
  document.removeEventListener('pointerup', handleImageDragEnd);
  document.removeEventListener('pointercancel', handleImageDragEnd);
  document.removeEventListener('pointermove', handleImageResizeMove);
  document.removeEventListener('pointerup', handleImageResizeEnd);
  document.removeEventListener('pointercancel', handleImageResizeEnd);
  imageDragState = null;
  imageResizeState = null;
  if(activeImageOverlay){
    activeImageOverlay.removeAttribute('data-dragging');
    activeImageOverlay.removeAttribute('data-resizing');
  }
}

function applyActiveImageFrame({ x, y, width, height } = {}){
  if(!hasActiveImageOverlay()) return;
  if(Number.isFinite(x)) activeImageState.x = x;
  if(Number.isFinite(y)) activeImageState.y = y;
  if(Number.isFinite(width)) activeImageState.width = Math.max(1, width);
  if(Number.isFinite(height)) activeImageState.height = Math.max(1, height);
  activeImageOverlay.style.left = `${activeImageState.x}px`;
  activeImageOverlay.style.top = `${activeImageState.y}px`;
  activeImageOverlay.style.width = `${activeImageState.width}px`;
  activeImageOverlay.style.height = `${activeImageState.height}px`;
}

function handleImageDragMove(e){
  if(!imageDragState) return;
  if(e.pointerId !== undefined && e.pointerId !== imageDragState.pointerId) return;
  const dx = e.clientX - imageDragState.startX;
  const dy = e.clientY - imageDragState.startY;
  applyActiveImageFrame({
    x: imageDragState.originX + dx,
    y: imageDragState.originY + dy
  });
  e.preventDefault();
}

function handleImageDragEnd(e){
  if(!imageDragState) return;
  if(e.pointerId !== undefined && e.pointerId !== imageDragState.pointerId) return;
  stopImageInteractionListeners();
}

function startImageDrag(e){
  if(!hasActiveImageOverlay()) return;
  if(e.button !== undefined && e.button !== 0) return;
  if(e.target.closest('.image-overlay-handle')) return;
  e.preventDefault();
  e.stopPropagation();
  imageDragState = {
    pointerId: e.pointerId ?? 'mouse',
    startX: e.clientX,
    startY: e.clientY,
    originX: activeImageState.x,
    originY: activeImageState.y
  };
  if(activeImageOverlay?.setPointerCapture && e.pointerId !== undefined){
    try{ activeImageOverlay.setPointerCapture(e.pointerId); }catch(err){}
  }
  activeImageOverlay?.setAttribute('data-dragging', 'true');
  document.addEventListener('pointermove', handleImageDragMove);
  document.addEventListener('pointerup', handleImageDragEnd);
  document.addEventListener('pointercancel', handleImageDragEnd);
}

function handleImageResizeMove(e){
  if(!imageResizeState) return;
  if(e.pointerId !== undefined && e.pointerId !== imageResizeState.pointerId) return;
  const dx = e.clientX - imageResizeState.startX;
  const dy = e.clientY - imageResizeState.startY;
  const { originX, originY, originWidth, originHeight, direction } = imageResizeState;
  let newX = originX;
  let newY = originY;
  let newWidth = originWidth;
  let newHeight = originHeight;
  if(direction.includes('e')){
    newWidth = originWidth + dx;
  } else if(direction.includes('w')){
    newWidth = originWidth - dx;
    newX = originX + dx;
  }
  if(direction.includes('s')){
    newHeight = originHeight + dy;
  } else if(direction.includes('n')){
    newHeight = originHeight - dy;
    newY = originY + dy;
  }
  if(newWidth < IMAGE_MIN_SIZE){
    const rightEdge = originX + originWidth;
    newWidth = IMAGE_MIN_SIZE;
    if(direction.includes('w')){
      newX = rightEdge - IMAGE_MIN_SIZE;
    }
  }
  if(newHeight < IMAGE_MIN_SIZE){
    const bottomEdge = originY + originHeight;
    newHeight = IMAGE_MIN_SIZE;
    if(direction.includes('n')){
      newY = bottomEdge - IMAGE_MIN_SIZE;
    }
  }
  applyActiveImageFrame({ x: newX, y: newY, width: newWidth, height: newHeight });
  e.preventDefault();
}

function handleImageResizeEnd(e){
  if(!imageResizeState) return;
  if(e.pointerId !== undefined && e.pointerId !== imageResizeState.pointerId) return;
  stopImageInteractionListeners();
}

function startImageResize(e, direction){
  if(!hasActiveImageOverlay()) return;
  if(e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  imageResizeState = {
    pointerId: e.pointerId ?? 'mouse',
    startX: e.clientX,
    startY: e.clientY,
    originX: activeImageState.x,
    originY: activeImageState.y,
    originWidth: activeImageState.width,
    originHeight: activeImageState.height,
    direction
  };
  if(activeImageOverlay?.setPointerCapture && e.pointerId !== undefined){
    try{ activeImageOverlay.setPointerCapture(e.pointerId); }catch(err){}
  }
  activeImageOverlay?.setAttribute('data-resizing', direction);
  document.addEventListener('pointermove', handleImageResizeMove);
  document.addEventListener('pointerup', handleImageResizeEnd);
  document.addEventListener('pointercancel', handleImageResizeEnd);
}

function handleActiveImageKeydown(e){
  if(!hasActiveImageOverlay()) return;
  if(e.key === 'Enter'){
    e.preventDefault();
    finalizeActiveImage();
  } else if(e.key === 'Escape'){
    e.preventDefault();
    cancelActiveImage();
  }
}

function cancelActiveImage(){
  if(!hasActiveImageOverlay()) return false;
  stopImageInteractionListeners();
  document.removeEventListener('keydown', handleActiveImageKeydown);
  activeImageOverlay?.remove();
  activeImageOverlay = null;
  activeImageState = null;
  return true;
}

function finalizeActiveImage({ commit=true } = {}){
  if(!hasActiveImageOverlay()) return false;
  const state = { ...activeImageState };
  stopImageInteractionListeners();
  document.removeEventListener('keydown', handleActiveImageKeydown);
  activeImageOverlay?.remove();
  activeImageOverlay = null;
  activeImageState = null;
  if(!commit){
    return true;
  }
  try{
    beginHistoryAction();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(state.imgEl, state.x, state.y, state.width, state.height);
    ctx.restore();
    commitHistoryAction();
    schedulePageSnapshot();
    emitImage({ dataUrl: state.dataUrl, x: state.x, y: state.y, width: state.width, height: state.height });
  }catch(err){
    console.warn('No se pudo fijar la imagen en el lienzo.', err);
    historyActionStarted = false;
    updateHistoryUi();
    return false;
  }
  return true;
}

function handleActiveImagePointerDown(e){
  startImageDrag(e);
}

function mountActiveImageOverlay({ dataUrl, img, x, y, width, height }){
  if(!board || !canvas) return;
  cancelActiveImage();
  const overlay = document.createElement('div');
  overlay.className = 'image-overlay';
  overlay.style.left = `${x}px`;
  overlay.style.top = `${y}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.setAttribute('role', 'group');
  overlay.setAttribute('aria-label', 'Imagen insertada. Arrastra para mover y usa los puntos para redimensionar.');
  overlay.addEventListener('pointerdown', handleActiveImagePointerDown);
  overlay.addEventListener('contextmenu', e=> e.preventDefault());
  overlay.addEventListener('dblclick', ()=> finalizeActiveImage());

  img.classList.add('image-overlay-img');
  img.draggable = false;
  overlay.appendChild(img);

  ['nw','ne','sw','se'].forEach(dir=>{
    const handle = document.createElement('span');
    handle.className = `image-overlay-handle image-overlay-handle-${dir}`;
    handle.addEventListener('pointerdown', e=> startImageResize(e, dir));
    overlay.appendChild(handle);
  });

  board.appendChild(overlay);
  activeImageOverlay = overlay;
  activeImageState = {
    dataUrl,
    imgEl: img,
    x,
    y,
    width,
    height
  };
  document.addEventListener('keydown', handleActiveImageKeydown);
}

function finalizeActiveImageIfPresent(){
  if(!hasActiveImageOverlay()) return false;
  return finalizeActiveImage();
}

function placeImageOnCanvas(dataUrl){
  if(!dataUrl) return;
  finalizeActiveImageIfPresent();
  const img = new Image();
  img.onload = ()=>{
    const canvasWidth = canvas.clientWidth || canvas.width || board?.clientWidth || window.innerWidth || 1;
    const canvasHeight = canvas.clientHeight || canvas.height || board?.clientHeight || window.innerHeight || 1;
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
    applyActiveImageFrame({ x, y, width: drawWidth, height: drawHeight });
  };
  img.onerror = ()=> console.warn('No se pudo cargar la imagen seleccionada.');
  img.src = dataUrl;
}

function performUndo(){
  if(!isHost) return;
  finalizeActiveImageIfPresent();
  if(undoStack.length <= 1) return;
  const current = undoStack.pop();
  redoStack.push(current);
  if(redoStack.length > HISTORY_LIMIT) redoStack.shift();
  const snapshot = undoStack[undoStack.length - 1];
  applySnapshot(snapshot).then(()=>{
    schedulePageSnapshot();
    broadcastCanvasSnapshot();
    updateHistoryUi();
  }).catch(()=> updateHistoryUi());
}

function performRedo(){
  if(!isHost) return;
  finalizeActiveImageIfPresent();
  if(redoStack.length === 0) return;
  const snapshot = redoStack.pop();
  undoStack.push(snapshot);
  if(undoStack.length > HISTORY_LIMIT) undoStack.shift();
  applySnapshot(snapshot).then(()=>{
    schedulePageSnapshot();
    broadcastCanvasSnapshot();
    updateHistoryUi();
  }).catch(()=> updateHistoryUi());
}
