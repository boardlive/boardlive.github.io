const SOLID_BASE_COLOR = '#ffffff';

function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const shortHexMatch = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortHexMatch) {
    const [r, g, b] = shortHexMatch[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function encodeSvg(svg) {
  return encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
}

function svgBackground({
  width,
  height,
  baseColor = SOLID_BASE_COLOR,
  content
}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${baseColor}"/>${content}</svg>`;
  const dataUrl = `url("data:image/svg+xml,${encodeSvg(svg)}")`;
  return `${baseColor} ${dataUrl}`;
}

function extractBackgroundImage(style) {
  if (typeof style !== 'string') return null;
  const index = style.indexOf('url(');
  if (index === -1) return null;
  return style.slice(index).trim();
}

function finalizeBackground({
  pattern,
  color,
  style,
  preset = null
}) {
  const resolvedStyle =
    typeof style === 'string' && style.trim().length > 0
      ? style.trim()
      : SOLID_BASE_COLOR;
  const resolvedColor = normalizeColor(color) ?? SOLID_BASE_COLOR;
  const size =
    preset && Array.isArray(preset.tileSize)
      ? {
          width: Number(preset.tileSize[0]) || null,
          height: Number(preset.tileSize[1]) || null
        }
      : null;
  return {
    pattern: pattern || 'solid',
    color: resolvedColor,
    style: resolvedStyle,
    image: extractBackgroundImage(resolvedStyle),
    size
  };
}

const BACKGROUND_PRESETS = [
  {
    id: 'solid',
    label: 'Sin pauta (color sólido)',
    supportsColor: true,
    baseColor: SOLID_BASE_COLOR,
    style: SOLID_BASE_COLOR
  },
  {
    id: 'grid',
    label: 'Cuadrícula',
    supportsColor: false,
    baseColor: '#ffffff',
    style: svgBackground({
      width: 64,
      height: 64,
      baseColor: '#ffffff',
      content:
        '<path d="M0 0H64" stroke="#d1d5db" stroke-width="1"/><path d="M0 32H64" stroke="#e5e7eb" stroke-width="1"/><path d="M0 0V64" stroke="#d1d5db" stroke-width="1"/><path d="M32 0V64" stroke="#e5e7eb" stroke-width="1"/>'
    }),
    tileSize: [64, 64]
  },
  {
    id: 'lined',
    label: 'Pauta (rayado)',
    supportsColor: false,
    baseColor: '#fbfdff',
    style: svgBackground({
      width: 8,
      height: 72,
      baseColor: '#fbfdff',
      content:
        '<path d="M0 71.5H8" stroke="#60a5fa" stroke-width="1.5"/>'
    }),
    tileSize: [8, 72]
  },
  {
    id: 'pentagram',
    label: 'Pentagrama',
    supportsColor: false,
    baseColor: '#fffdf5',
    style: svgBackground({
      width: 8,
      height: 120,
      baseColor: '#fffdf5',
      content:
        '<path d="M0 28H8" stroke="#2563eb" stroke-width="1"/><path d="M0 42H8" stroke="#2563eb" stroke-width="1"/><path d="M0 56H8" stroke="#2563eb" stroke-width="1"/><path d="M0 70H8" stroke="#2563eb" stroke-width="1"/><path d="M0 84H8" stroke="#2563eb" stroke-width="1"/>'
    }),
    tileSize: [8, 120]
  },
  {
    id: 'millimeter',
    label: 'Fondo milimetrado',
    supportsColor: false,
    baseColor: '#ffffff',
    style: svgBackground({
      width: 16,
      height: 16,
      baseColor: '#ffffff',
      content:
        '<path d="M0 0H16" stroke="#dbeafe" stroke-width="0.5"/><path d="M0 8H16" stroke="#bfdbfe" stroke-width="0.5" opacity="0.7"/><path d="M0 0V16" stroke="#dbeafe" stroke-width="0.5"/><path d="M8 0V16" stroke="#bfdbfe" stroke-width="0.5" opacity="0.7"/>'
    }),
    tileSize: [16, 16]
  },
  {
    id: 'large-grid',
    label: 'Cuadros grandes',
    supportsColor: false,
    baseColor: '#ffffff',
    style: svgBackground({
      width: 96,
      height: 96,
      baseColor: '#ffffff',
      content:
        '<path d="M0 0H96" stroke="#cbd5f5" stroke-width="1.5"/><path d="M0 48H96" stroke="#e5e7eb" stroke-width="1"/><path d="M0 0V96" stroke="#cbd5f5" stroke-width="1.5"/><path d="M48 0V96" stroke="#e5e7eb" stroke-width="1"/>'
    }),
    tileSize: [96, 96]
  },
  {
    id: 'double-lines',
    label: 'Pauta Montessori (líneas dobles)',
    supportsColor: false,
    baseColor: '#fffefa',
    style: svgBackground({
      width: 8,
      height: 120,
      baseColor: '#fffefa',
      content:
        '<path d="M0 42H8" stroke="#2563eb" stroke-width="1.5" opacity="0.9"/><path d="M0 60H8" stroke="#dc2626" stroke-width="1.5" opacity="0.9"/><path d="M0 78H8" stroke="#2563eb" stroke-width="1.5" opacity="0.9"/>'
    }),
    tileSize: [8, 120]
  }
];

const PATTERN_BY_ID = new Map(
  BACKGROUND_PRESETS.map(preset => [preset.id, preset])
);

const STYLE_TO_PATTERN = new Map(
  BACKGROUND_PRESETS.filter(preset => !preset.supportsColor).map(preset => [
    preset.style,
    preset.id
  ])
);

export function listBackgroundPresets() {
  return BACKGROUND_PRESETS.map(preset => ({ ...preset }));
}

export function resolveBackgroundSetting({
  pattern,
  color,
  style
} = {}) {
  if (pattern && PATTERN_BY_ID.has(pattern)) {
    const preset = PATTERN_BY_ID.get(pattern);
    if (preset.supportsColor) {
      const normalized = normalizeColor(color) ?? preset.baseColor;
      return finalizeBackground({
        pattern: preset.id,
        color: normalized,
        style: normalized,
        preset
      });
    }
    return finalizeBackground({
      pattern: preset.id,
      color: preset.baseColor,
      style: preset.style,
      preset
    });
  }

  if (typeof style === 'string') {
    const trimmed = style.trim();
    if (STYLE_TO_PATTERN.has(trimmed)) {
      const presetId = STYLE_TO_PATTERN.get(trimmed);
      const preset = PATTERN_BY_ID.get(presetId);
      return finalizeBackground({
        pattern: preset.id,
        color: preset.baseColor,
        style: preset.style,
        preset
      });
    }
    const normalized = normalizeColor(trimmed);
    if (normalized) {
      return finalizeBackground({
        pattern: 'solid',
        color: normalized,
        style: normalized
      });
    }
  }

  if (typeof color === 'string') {
    const normalized = normalizeColor(color);
    if (normalized) {
      return finalizeBackground({
        pattern: 'solid',
        color: normalized,
        style: normalized
      });
    }
  }

  return finalizeBackground({
    pattern: 'solid',
    color: SOLID_BASE_COLOR,
    style: SOLID_BASE_COLOR
  });
}

export function detectBackgroundPattern(style) {
  if (typeof style !== 'string') return null;
  const trimmed = style.trim();
  if (STYLE_TO_PATTERN.has(trimmed)) {
    return STYLE_TO_PATTERN.get(trimmed);
  }
  return null;
}

export function normalizeBackgroundColor(value) {
  return normalizeColor(value) ?? SOLID_BASE_COLOR;
}
