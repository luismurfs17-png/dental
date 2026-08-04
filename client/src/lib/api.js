const API_BASE = '/api'

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function api(path, options = {}) {
  const { body, headers, ...rest } = options
  const isForm = body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: isForm ? headers : { 'Content-Type': 'application/json', ...headers },
    body: isForm || typeof body === 'string' ? body : body == null ? undefined : JSON.stringify(body),
    ...rest,
  })

  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = data?.mensaje || data?.message || data?.error || 'No pudimos completar la solicitud.'
    throw new ApiError(message, response.status, data)
  }
  return data
}

export function unwrap(data, key) {
  if (Array.isArray(data)) return data
  return data?.[key] ?? data?.data ?? []
}

export function formatMoney(value) {
  return new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    minimumFractionDigits: 0,
  }).format(Number(value || 0)).replace('BOB', 'Bs')
}

export function formatDate(value, options = {}) {
  if (!value) return 'Por definir'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('es-BO', {
    day: 'numeric',
    month: 'short',
    year: options.short ? undefined : 'numeric',
    ...options,
  }).format(parsed)
}

export function formatTime(value) {
  if (!value) return ''
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5)
  return new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
