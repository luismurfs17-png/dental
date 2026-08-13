export const DEFAULT_BRAND = {
  name: 'PORTAL CLÍNICO',
  primary: '#24577a',
  accent: '#6672bd',
  background: '#f3fafc',
  backgroundOpacity: 18,
}

export function clinicBrand(clinic) {
  return {
    name: clinic?.marca_nombre || clinic?.nombre || DEFAULT_BRAND.name,
    logo: clinic?.logo_url || null,
    primary: validColor(clinic?.color_primario, DEFAULT_BRAND.primary),
    accent: validColor(clinic?.color_acento, DEFAULT_BRAND.accent),
    background: validColor(clinic?.color_fondo, DEFAULT_BRAND.background),
    backgroundImage: clinic?.fondo_url || null,
    backgroundOpacity: clamp(Number(clinic?.fondo_opacidad ?? DEFAULT_BRAND.backgroundOpacity), 0, 45),
  }
}

export function clinicTheme(clinic) {
  const brand = clinicBrand(clinic)
  const soft = mix(brand.primary, '#ffffff', .84)
  const softAccent = mix(brand.accent, '#ffffff', .82)
  const border = mix(brand.primary, '#ffffff', .78)
  return {
    '--primary': brand.primary,
    '--primary-hover': mix(brand.primary, '#000000', .18),
    '--secondary': brand.accent,
    '--accent': brand.accent,
    '--accent-contrast': contrastText(brand.accent),
    '--soft': soft,
    '--soft-blue': softAccent,
    '--background': brand.background,
    '--border': border,
    '--petrol': brand.primary,
    '--petrol-2': mix(brand.primary, '#000000', .18),
    '--teal': brand.primary,
    '--mint': soft,
    '--cream': brand.background,
    '--coral': brand.accent,
    '--coral-dark': mix(brand.accent, '#000000', .2),
    '--line': border,
    '--brand-background-image': brand.backgroundImage ? `url("${brand.backgroundImage}")` : 'none',
    '--brand-background-opacity': String(brand.backgroundImage ? brand.backgroundOpacity / 100 : 0),
  }
}

function validColor(value, fallback) {
  const color = String(value || '').toLowerCase()
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback
}

function mix(first, second, amount) {
  const a = rgb(first)
  const b = rgb(second)
  const channel = (key) => Math.round(a[key] * (1 - amount) + b[key] * amount).toString(16).padStart(2, '0')
  return `#${channel('r')}${channel('g')}${channel('b')}`
}

function rgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

function contrastText(hex) {
  const dark = '#17354a'
  return contrast(hex, dark) >= contrast(hex, '#ffffff') ? dark : '#ffffff'
}

function contrast(first, second) {
  const light = Math.max(luminance(first), luminance(second))
  const dark = Math.min(luminance(first), luminance(second))
  return (light + .05) / (dark + .05)
}

function luminance(hex) {
  const value = rgb(hex)
  const channels = [value.r, value.g, value.b].map((channel) => {
    const normalized = channel / 255
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
  })
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : DEFAULT_BRAND.backgroundOpacity
}
