export const $ = (id) => document.getElementById(id);

export function rndCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function sanitizeCode(raw) {
  const upper = (raw ?? '').toString().trim().toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9-]/g, '');
  return cleaned.slice(0, 32);
}

export function sanitizeHexColor(raw, fallback = '#000000') {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
    const hex = value.startsWith('#') ? value.slice(1) : value;
    return `#${hex.toUpperCase()}`;
  }
  return fallback;
}

export function hexToRgb(hex) {
  const normalized = hex?.toString().trim();
  if (!normalized || !/^#?[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

export function highlightColor(base, alpha = 0.32) {
  const rgb = hexToRgb(base);
  if (!rgb) return `rgba(255,255,0,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function clamp(value, min, max) {
  const n = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, n));
}

export function isTextInput(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') return false;
  if (element.tagName === 'INPUT') {
    const type = element.type?.toLowerCase();
    const blocked = ['button', 'checkbox', 'radio', 'submit', 'reset', 'file'];
    if (blocked.includes(type)) return false;
  }
  return true;
}
