export function whatsappUrl(phone, name = '') {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 8) digits = `591${digits}`
  if (!digits) return ''
  const message = `Hola${name ? ` ${name}` : ''}, le escribimos del consultorio SONRIDENT. Esperamos que se encuentre bien.`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function emailUrl(email, name = '') {
  if (!email) return ''
  const subject = 'Mensaje de su consultorio SONRIDENT'
  const body = `Hola${name ? ` ${name}` : ''},\n\nEsperamos que se encuentre bien. Nos comunicamos desde el consultorio SONRIDENT.\n\nSaludos cordiales.`
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: email, su: subject, body })
  return `https://mail.google.com/mail/?${params.toString()}`
}
