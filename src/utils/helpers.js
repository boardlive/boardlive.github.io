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

function parseRgbString(value) {
  if (typeof value !== 'string') return null;
  const match = value
    .replace(/\s+/g, '')
    .match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,\d*(?:\.\d+)?)?\)$/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (
    Number.isInteger(r) &&
    Number.isInteger(g) &&
    Number.isInteger(b) &&
    r >= 0 &&
    r <= 255 &&
    g >= 0 &&
    g <= 255 &&
    b >= 0 &&
    b <= 255
  ) {
    return { r, g, b };
  }
  return null;
}

export function colorLuminance(value) {
  if (!value) return null;
  let rgb = null;
  const trimmed = value.toString().trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    rgb = hexToRgb(trimmed);
  } else if (/^rgba?/i.test(trimmed)) {
    rgb = parseRgbString(trimmed);
  }
  if (!rgb) return null;
  const luminance =
    (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance;
}

export function isLightColor(value, threshold = 0.6) {
  const luminance = colorLuminance(value);
  if (luminance === null) return false;
  return luminance >= threshold;
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
