export function whatsappUrl(phone, name = '', clinic = '') {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 8) digits = `591${digits}`
  if (!digits) return ''
  const message = `Hola${name ? ` ${name}` : ''}, le escribimos de ${clinic || 'su consultorio'}. Esperamos que se encuentre bien.`
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function emailUrl(email, name = '', clinic = '') {
  if (!email) return ''
  const subject = `Mensaje de ${clinic || 'su consultorio'}`
  const body = `Hola${name ? ` ${name}` : ''},\n\nEsperamos que se encuentre bien. Nos comunicamos desde ${clinic || 'su consultorio'}.\n\nSaludos cordiales.`
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: email, su: subject, body })
  return `https://mail.google.com/mail/?${params.toString()}`
}
