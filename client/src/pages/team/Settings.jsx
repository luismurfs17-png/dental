import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { api, unwrap } from '../../lib/api.js'
import { useRemote } from '../../hooks/useRemote.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { clinicBrand, clinicTheme, DEFAULT_BRAND, BRAND_PALETTES, BRAND_FONTS, FONT_FOR } from '../../lib/branding.js'
import Icon from '../../components/Icon.jsx'
import { ErrorState, Field, Loading, PageHeader, Toast } from '../../components/UI.jsx'

const weekdays = [
  { dia_semana: 1, dia: 'lunes' }, { dia_semana: 2, dia: 'martes' }, { dia_semana: 3, dia: 'miércoles' },
  { dia_semana: 4, dia: 'jueves' }, { dia_semana: 5, dia: 'viernes' }, { dia_semana: 6, dia: 'sábado' },
  { dia_semana: 0, dia: 'domingo' },
]

export default function Settings() {
  const { user, setUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const clinicRemote = useRemote('/consultorio')
  const hoursRemote = useRemote('/horarios')
  const usersRemote = useRemote('/usuarios')
  const emailRemote = useRemote('/correo/configuracion')
  const [clinic, setClinic] = useState({})
  const [hours, setHours] = useState([])
  const [invite, setInvite] = useState({ nombre: '', email: '', rol: 'operativo' })
  const [qrFile, setQrFile] = useState(null)
  const [logoFile, setLogoFile] = useState(null)
  const [backgroundFile, setBackgroundFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [portalQr, setPortalQr] = useState('')
  const [emailForm, setEmailForm] = useState({ modo: 'global', correo_prueba: '' })
  const [emailReminderHours, setEmailReminderHours] = useState(null)
  const [envios, setEnvios] = useState([])
  const [testing, setTesting] = useState(false)
  const logoPreview = useFilePreview(logoFile)
  const backgroundPreview = useFilePreview(backgroundFile)
  const brand = clinicBrand({
    ...clinic,
    logo_url: logoPreview || clinic.logo_url,
    fondo_url: backgroundPreview || clinic.fondo_url,
  })
  const brandTheme = clinicTheme({
    ...clinic,
    logo_url: logoPreview || clinic.logo_url,
    fondo_url: backgroundPreview || clinic.fondo_url,
  })
  const kitStyle = {
    '--brand-gradient': brandTheme['--brand-gradient'],
    '--font-heading': brandTheme['--font-heading'],
  }
  const paletteName = BRAND_PALETTES.find((palette) => palette.primary === (clinic.color_primario || DEFAULT_BRAND.primary) && palette.accent === (clinic.color_acento || DEFAULT_BRAND.accent))?.name || 'Paleta personalizada'
  const fondoEstilo = clinic.fondo_estilo || 'imagen'
  const fondoLabel = fondoEstilo === 'imagen' ? (brand.backgroundImage ? 'Imagen del consultorio' : 'Color de fondo') : fondoEstilo === 'degradado' ? 'Degradado de marca' : 'Color limpio'
  const fondoDot = fondoEstilo === 'degradado' ? brandTheme['--brand-gradient'] : fondoEstilo === 'color' ? (clinic.color_fondo || DEFAULT_BRAND.background) : brand.primary
  const contactLabel = [brand.whatsapp && 'WhatsApp', brand.facebook && 'Facebook', brand.instagram && 'Instagram'].filter(Boolean).join(' · ') || 'No configurado'
  const portalUrl = clinic.app_path ? `${window.location.origin}${clinic.app_path}` : ''

  useEffect(() => setClinic(clinicRemote.data?.consultorio || {}), [clinicRemote.data])
  useEffect(() => {
    const loaded = clinicRemote.data?.consultorio
    if (!loaded) return
    setEmailReminderHours(loaded.recordatorio_horas ?? null)
  }, [clinicRemote.data])
  useEffect(() => {
    let active = true
    if (!portalUrl) { setPortalQr(''); return undefined }
    QRCode.toDataURL(portalUrl, { width: 360, margin: 1, color: { dark: clinic.color_primario || DEFAULT_BRAND.primary, light: '#ffffff' } })
      .then((url) => { if (active) setPortalQr(url) })
      .catch(() => { if (active) setPortalQr('') })
    return () => { active = false }
  }, [portalUrl, clinic.color_primario])
  useEffect(() => {
    const loaded = unwrap(hoursRemote.data, 'horarios')
    setHours(weekdays.map((day) => {
      const item = loaded.find((entry) => entry.dia_semana === day.dia_semana)
      return { ...day, id: item?.id, activo: Boolean(item), hora_inicio: item?.hora_inicio || '08:00', hora_fin: item?.hora_fin || '18:00' }
    }))
  }, [hoursRemote.data])

  useEffect(() => {
    const cfg = emailRemote.data?.configuracion
    if (!cfg) return
    setEmailForm((current) => ({ ...current, modo: cfg.oauth_conectado ? 'google' : 'global' }))
  }, [emailRemote.data])

  useEffect(() => {
    const state = searchParams.get('correo')
    if (!state) return
    if (state === 'conectado') setMessage('Correo de Google conectado correctamente.')
    else setMessage(`No se pudo conectar el correo: ${searchParams.get('motivo') || 'vuelve a intentarlo'}`)
    emailRemote.reload()
    setSearchParams({}, { replace: true })
  }, [searchParams, emailRemote.reload, setSearchParams])

  async function loadEnvios() {
    try { setEnvios(unwrap(await api('/correo/envios'), 'envios')) }
    catch { setEnvios([]) }
  }

  async function saveEmail(event) {
    event.preventDefault(); setSaving(true)
    try {
      const result = await api('/correo/configuracion', { method: 'PUT', body: { modo: emailForm.modo } })
      setMessage(result.mensaje)
      await emailRemote.reload()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function disconnectGmail() {
    setSaving(true)
    try {
      const result = await api('/correo/gmail/desconectar', { method: 'POST' })
      setEmailForm((current) => ({ ...current, modo: 'global' }))
      await emailRemote.reload()
      setMessage(result.mensaje)
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function sendTestEmail(event) {
    event.preventDefault(); setTesting(true)
    try {
      const result = await api('/correo/probar', { method: 'POST', body: { correo: emailForm.correo_prueba } })
      setMessage(result.mensaje)
    } catch (error) { setMessage(error.message) } finally { setTesting(false) }
  }

  async function saveReminderHours() {
    setSaving(true)
    try {
      const result = await api('/consultorio', { method: 'PATCH', body: { recordatorio_horas: emailReminderHours } })
      setMessage(emailReminderHours ? `Recordatorio guardado: ${emailReminderHours} horas antes.` : 'Recordatorios inteligentes activados (mañana → día antes 20:00, tarde → 08:00).')
      await clinicRemote.reload()
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  if (clinicRemote.loading || hoursRemote.loading) return <Loading label="Cargando el consultorio" />
  if (clinicRemote.error || hoursRemote.error) return <ErrorState message={clinicRemote.error || hoursRemote.error} onRetry={() => { clinicRemote.reload(); hoursRemote.reload() }} />

  async function saveClinic(event, fields) {
    event.preventDefault(); setSaving(true)
    try {
      const body = Object.fromEntries(fields.map((field) => [field, clinic[field]]))
      const result = await api('/consultorio', { method: 'PATCH', body })
      updateClinic(result.consultorio); setMessage('Información actualizada.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function saveIdentity(event) {
    event.preventDefault(); setSaving(true)
    try {
      let result = await api('/consultorio', {
        method: 'PATCH',
        body: {
          marca_nombre: clinic.marca_nombre || '',
          color_primario: clinic.color_primario || DEFAULT_BRAND.primary,
          color_acento: clinic.color_acento || DEFAULT_BRAND.accent,
          color_fondo: clinic.color_fondo || DEFAULT_BRAND.background,
          fondo_opacidad: Number(clinic.fondo_opacidad ?? DEFAULT_BRAND.backgroundOpacity),
          eslogan: clinic.eslogan || '',
          bienvenida: clinic.bienvenida || '',
          whatsapp: clinic.whatsapp || '',
          facebook: clinic.facebook || '',
          instagram: clinic.instagram || '',
          ubicacion: clinic.ubicacion || '',
          tipografia: clinic.tipografia || 'fraunces',
          fondo_estilo: clinic.fondo_estilo || 'imagen',
        },
      })
      updateClinic(result.consultorio)
      for (const [type, file] of [['logo', logoFile], ['fondo', backgroundFile]]) {
        if (!file) continue
        const body = new FormData(); body.append('imagen', file)
        result = await api(`/consultorio/identidad/${type}`, { method: 'POST', body })
        updateClinic(result.consultorio)
        if (type === 'logo') setLogoFile(null)
        else setBackgroundFile(null)
      }
      setLogoFile(null); setBackgroundFile(null); setMessage('Identidad visual actualizada.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function removeIdentityImage(type) {
    setSaving(true)
    try {
      const result = await api(`/consultorio/identidad/${type}`, { method: 'DELETE' })
      updateClinic(result.consultorio)
      if (type === 'logo') setLogoFile(null)
      else setBackgroundFile(null)
      setMessage(type === 'logo' ? 'Logo eliminado.' : 'Fondo eliminado.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  function updateClinic(nextClinic) {
    setClinic(nextClinic)
    setUser((current) => current ? { ...current, consultorio: nextClinic } : current)
  }

  function selectIdentityFile(type, file) {
    if (file && file.size > 5 * 1024 * 1024) {
      setMessage('La imagen no puede superar 5 MB.')
      return
    }
    if (type === 'logo') setLogoFile(file || null)
    else setBackgroundFile(file || null)
  }

  async function sharePortal() {
    if (!portalUrl) return
    try {
      if (navigator.share) await navigator.share({ title: brand.name, text: `Accede a ${brand.name}`, url: portalUrl })
      else { await navigator.clipboard.writeText(portalUrl); setMessage('Enlace copiado.') }
    } catch (error) {
      if (error.name !== 'AbortError') setMessage('No se pudo compartir el enlace.')
    }
  }

  async function copyPortal() {
    try { await navigator.clipboard.writeText(portalUrl); setMessage('Enlace copiado.') }
    catch { setMessage('No se pudo copiar el enlace.') }
  }

  function downloadPortalQr() {
    if (!portalQr) return
    const link = document.createElement('a')
    link.href = portalQr
    link.download = `qr-${clinic.slug || 'clinica'}.png`
    link.click()
  }

  async function saveHours() {
    setSaving(true)
    try {
      await Promise.all(unwrap(hoursRemote.data, 'horarios').map((item) => api(`/horarios/${item.id}`, { method: 'DELETE' })))
      for (const item of hours.filter((entry) => entry.activo)) {
        await api('/horarios', { method: 'POST', body: { dia_semana: item.dia_semana, hora_inicio: item.hora_inicio, hora_fin: item.hora_fin } })
      }
      await hoursRemote.reload(); setMessage('Horarios actualizados.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function uploadQr() {
    if (!qrFile) return
    setSaving(true)
    const body = new FormData(); body.append('imagen', qrFile)
    try {
      const result = await api('/consultorio/qr', { method: 'POST', body })
      setClinic({ ...clinic, qr_url: result.qr_url }); setQrFile(null); setMessage('QR de pagos actualizado.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  async function sendInvite(event) {
    event.preventDefault(); setSaving(true)
    try {
      await api('/usuarios/invitaciones', { method: 'POST', body: invite })
      setInvite({ nombre: '', email: '', rol: 'operativo' }); usersRemote.reload(); setMessage('Invitación operativa registrada.')
    } catch (error) { setMessage(error.message) } finally { setSaving(false) }
  }

  const emailCfg = emailRemote.data?.configuracion || {}
  const oauthConectado = Boolean(emailCfg.oauth_conectado)
  const oauthEmail = emailCfg.oauth_email || ''
  const gmailDisponible = Boolean(emailCfg.gmail_disponible)
  const smtpLegacy = emailCfg.modo === 'propio' && !oauthConectado
  const statusStrong = oauthConectado ? `Correo de Google conectado (${oauthEmail})` : smtpLegacy ? 'Correo SMTP propio configurado' : 'Usando correo de la plataforma'
  const statusSmall = oauthConectado
    ? (emailCfg.global_activo ? 'También está disponible el correo global.' : 'Los envíos salen desde tu cuenta de Google.')
    : smtpLegacy
      ? 'Conecta Google para administrarlo sin contraseñas.'
      : (emailCfg.global_activo ? 'El correo global está activo.' : 'Sin correo global: conecta Google para enviar avisos.')

  return <><PageHeader eyebrow="ADMINISTRACIÓN" title="Tu consultorio" description="Identidad, disponibilidad, equipo y medios de pago." /><div className="settings-grid">
    <form className="settings-card" onSubmit={(event) => saveClinic(event, ['nombre', 'telefono', 'direccion'])}><div className="settings-card-head"><span><Icon name="settings" /></span><div><h2>Información general</h2><p>Datos visibles para pacientes.</p></div></div><Field label="Nombre"><input value={clinic.nombre || ''} onChange={(e) => setClinic({ ...clinic, nombre: e.target.value })} required /></Field><Field label="Teléfono"><input value={clinic.telefono || ''} onChange={(e) => setClinic({ ...clinic, telefono: e.target.value })} /></Field><Field label="Dirección"><input value={clinic.direccion || ''} onChange={(e) => setClinic({ ...clinic, direccion: e.target.value })} /></Field><button className="button button-primary" disabled={saving}>Guardar información</button></form>
<form className="settings-card brand-studio" onSubmit={saveIdentity}><div className="settings-card-head"><span><Icon name="edit" /></span><div><h2>Estudio de marca</h2><p>Identidad, paleta, tipografía, fondo y contacto para pacientes y equipo.</p></div></div><div className="brand-kit"><div className="brand-kit-preview" style={kitStyle}><header><span className={brand.logo ? 'has-logo' : ''}>{brand.logo ? <img src={brand.logo} alt="Vista previa del logo" /> : <Icon name="tooth" />}</span><div><strong>{brand.name}</strong><small>{brand.eslogan || 'Tu consultorio, con identidad propia'}</small></div></header><div><h3>{brand.bienvenida || 'Tu sonrisa, nuestro cuidado'}</h3><p>Los pacientes ingresan, agendan y reciben avisos con el estilo de tu consultorio.</p></div><footer><span>{clinic.telefono ? `Teléfono: ${clinic.telefono}` : 'Teléfono de tu consultorio'}</span><span>{[brand.whatsapp && 'WhatsApp', brand.facebook && 'Facebook', brand.instagram && 'Instagram'].filter(Boolean).join(' · ') || 'Tus redes sociales'}</span></footer></div><div className="brand-kit-card"><header><strong>Así se ve tu marca</strong><small>Vista previa de la pantalla de ingreso y del portal de pacientes.</small></header><div className="brand-kit-row"><span><Icon name="edit" /></span><div><strong>Colores</strong><small>{paletteName}</small></div><div className="brand-kit-dots"><i style={{ background: brand.primary }} /><i style={{ background: brand.accent }} /><i style={{ background: brand.background }} /></div></div><div className="brand-kit-row"><span><Icon name="file" /></span><div><strong>Tipografía</strong><small>{FONT_FOR(clinic.tipografia || 'fraunces').name}</small></div><span className="brand-kit-chips"><i>Aa</i></span></div><div className="brand-kit-row"><span><Icon name="upload" /></span><div><strong>Fondo</strong><small>{fondoLabel}</small></div><span className="brand-kit-dots"><i style={{ background: fondoDot }} /></span></div><div className="brand-kit-row"><span><Icon name="whatsapp" /></span><div><strong>Contacto y redes</strong><small>{contactLabel}</small></div></div></div></div><div className="brand-section"><h3 className="brand-section-title">Identidad</h3><Field label="Nombre de marca" hint="Si lo dejas vacío se mostrará el nombre del consultorio."><input maxLength="60" value={clinic.marca_nombre || ''} onChange={(e) => setClinic({ ...clinic, marca_nombre: e.target.value })} placeholder={clinic.nombre || 'Nombre del consultorio'} /></Field><Field label="Eslogan" hint="Frase corta que acompaña tu nombre (máx. 90 caracteres)."><input maxLength="90" value={clinic.eslogan || ''} onChange={(e) => setClinic({ ...clinic, eslogan: e.target.value })} placeholder="Ej. Tu sonrisa, nuestro compromiso" /></Field><div className="identity-files"><IdentityFile label="Logo" hint="PNG, JPG o WEBP. Mejor si es cuadrado." file={logoFile} current={clinic.logo_url} onSelect={(file) => selectIdentityFile('logo', file)} onRemove={() => removeIdentityImage('logo')} disabled={saving} /><IdentityFile label="Imagen de fondo" hint="Se adapta a computadoras y celulares." file={backgroundFile} current={clinic.fondo_url} onSelect={(file) => selectIdentityFile('fondo', file)} onRemove={() => removeIdentityImage('fondo')} disabled={saving} /></div></div><div className="brand-section"><h3 className="brand-section-title">Paleta de colores<small>Personalizada</small></h3><p className="brand-section-hint">Elige una combinación lista o ajusta los colores a tu gusto.</p><div className="palette-grid">{BRAND_PALETTES.map((palette) => <button type="button" key={palette.name} className={`palette-swatch ${clinic.color_primario === palette.primary && clinic.color_acento === palette.accent ? 'active' : ''}`} style={{ '--palette-primary': palette.primary, '--palette-accent': palette.accent }} onClick={() => setClinic({ ...clinic, color_primario: palette.primary, color_acento: palette.accent, color_fondo: palette.background })}><i /><small>{palette.name}</small></button>)}</div><div className="brand-color-grid"><ColorField label="Principal" value={clinic.color_primario || DEFAULT_BRAND.primary} onChange={(value) => setClinic({ ...clinic, color_primario: value })} /><ColorField label="Acento" value={clinic.color_acento || DEFAULT_BRAND.accent} onChange={(value) => setClinic({ ...clinic, color_acento: value })} /><ColorField label="Fondo" value={clinic.color_fondo || DEFAULT_BRAND.background} onChange={(value) => setClinic({ ...clinic, color_fondo: value })} /></div></div><div className="brand-section"><h3 className="brand-section-title">Fondo con estilo</h3><p className="brand-section-hint">Elige cómo se ve el fondo del portal: tu imagen, un degradado o un color limpio.</p><div className="fondo-options"><button type="button" className={`fondo-option imagen ${fondoEstilo === 'imagen' ? 'active' : ''}`} style={{ '--fondo-preview': brand.backgroundImage || 'var(--petrol)' }} onClick={() => setClinic({ ...clinic, fondo_estilo: 'imagen' })}><i /><strong>Imagen</strong><small>Tu foto del consultorio, suavizada.</small></button><button type="button" className={`fondo-option degradado ${fondoEstilo === 'degradado' ? 'active' : ''}`} onClick={() => setClinic({ ...clinic, fondo_estilo: 'degradado' })}><i /><strong>Degradado</strong><small>Mezcla principal y acento.</small></button><button type="button" className={`fondo-option color ${fondoEstilo === 'color' ? 'active' : ''}`} style={{ '--fondo-color': clinic.color_fondo || DEFAULT_BRAND.background }} onClick={() => setClinic({ ...clinic, fondo_estilo: 'color' })}><i /><strong>Color</strong><small>Fondo limpio de un solo tono.</small></button></div><label className="background-intensity"><span><strong>Intensidad de la imagen</strong><small>{clinic.fondo_opacidad ?? DEFAULT_BRAND.backgroundOpacity}%</small></span><input type="range" min="0" max="45" value={clinic.fondo_opacidad ?? DEFAULT_BRAND.backgroundOpacity} onChange={(e) => setClinic({ ...clinic, fondo_opacidad: Number(e.target.value) })} /></label></div><div className="brand-section"><h3 className="brand-section-title">Tipografía</h3><p className="brand-section-hint">Cambia el estilo de los títulos en el portal y en la aplicación.</p><div className="font-options">{BRAND_FONTS.map((font) => <button type="button" key={font.value} className={`font-option ${(clinic.tipografia || 'fraunces') === font.value ? 'active' : ''}`} style={{ '--font-sample': font.stack }} onClick={() => setClinic({ ...clinic, tipografia: font.value })}><strong>Aa</strong><small>{font.name}</small></button>)}</div></div><div className="brand-section"><h3 className="brand-section-title">Mensaje de bienvenida</h3><p className="brand-section-hint">Texto de la pantalla de ingreso y del portal (máx. 200 caracteres).</p><input className="brand-input" maxLength="200" value={clinic.bienvenida || ''} onChange={(e) => setClinic({ ...clinic, bienvenida: e.target.value })} placeholder="Ej. Reserva tu cita y recupera tu sonrisa" /></div><div className="brand-section"><h3 className="brand-section-title">Contacto y redes</h3><p className="brand-section-hint">Los pacientes podrán escribirte directo desde el portal.</p><div className="brand-input-row"><div><label className="brand-label">WhatsApp<small>Con código de país</small></label><input className="brand-input-sm" value={clinic.whatsapp || ''} onChange={(e) => setClinic({ ...clinic, whatsapp: e.target.value })} placeholder="Ej. +58 412 555 1234" /></div><div><label className="brand-label">Facebook<small>Enlace completo</small></label><input className="brand-input-sm" value={clinic.facebook || ''} onChange={(e) => setClinic({ ...clinic, facebook: e.target.value })} placeholder="https://facebook.com/tu-clinica" /></div><div><label className="brand-label">Instagram<small>Enlace completo</small></label><input className="brand-input-sm" value={clinic.instagram || ''} onChange={(e) => setClinic({ ...clinic, instagram: e.target.value })} placeholder="https://instagram.com/tu-clinica" /></div></div><div className="brand-input-row"><div className="brand-ubicacion-input"><label className="brand-label">Ubicación para el mapa<small>Dirección o punto de referencia · un clic abre Google Maps</small></label><input className="brand-input-sm" maxLength="200" value={clinic.ubicacion || ''} onChange={(e) => setClinic({ ...clinic, ubicacion: e.target.value })} placeholder="Ej. Av. 6 de Agosto, Edif. Sonridente, piso 2" /></div></div></div><div className="identity-actions"><button type="button" className="button button-ghost" onClick={() => setClinic({ ...clinic, color_primario: DEFAULT_BRAND.primary, color_acento: DEFAULT_BRAND.accent, color_fondo: DEFAULT_BRAND.background, fondo_opacidad: DEFAULT_BRAND.backgroundOpacity })} disabled={saving}>Colores originales</button><button className="button button-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar identidad'}</button></div></form>
    <section className="settings-card portal-app-card"><div className="settings-card-head"><span><Icon name="phone" /></span><div><h2>Aplicación de tu clínica</h2><p>Comparte un acceso instalable con tu marca.</p></div></div><div className="portal-app-layout"><div className="portal-qr-wrap"><div className="portal-qr">{portalQr ? <img src={portalQr} alt={`QR de acceso a ${brand.name}`} /> : <Icon name="qr" size={58} />}</div><button type="button" onClick={downloadPortalQr} disabled={!portalQr}>Descargar QR</button></div><div className="portal-app-info"><strong>{brand.name}</strong><p>Este enlace funciona para doctores, equipo y pacientes. Cada perfil verá únicamente sus funciones.</p><div className="portal-url"><span>{portalUrl || 'Preparando enlace...'}</span><button type="button" onClick={copyPortal} disabled={!portalUrl}>Copiar</button></div><div className="portal-app-actions"><button type="button" className="button button-ghost" onClick={sharePortal} disabled={!portalUrl}><Icon name="upload" /> Compartir</button>{clinic.app_path && <a className="button button-primary" href={`${clinic.app_path}/instalar`} target="_blank" rel="noreferrer"><Icon name="phone" /> Instalar en este teléfono</a>}</div></div></div></section>
    <section className="settings-card email-card"><div className="settings-card-head"><span><Icon name="email" /></span><div><h2>Correos de tu clínica</h2><p>Confirmaciones, recordatorios y avisos con tu marca.</p></div></div><div className="modo-cobro-options">{[['global', 'Global', 'Usa el correo de la plataforma.'], ['google', 'Google (recomendado)', 'Conecta el Gmail de tu clínica con un clic, sin contraseñas.']].map(([value, label, hint]) => <label key={value} className={`modo-option ${emailForm.modo === value ? 'selected' : ''}`}><input type="radio" name="modo_correo" value={value} checked={emailForm.modo === value} onChange={(e) => setEmailForm({ ...emailForm, modo: e.target.value })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div>{emailForm.modo === 'google' ? (oauthConectado ? <div className="gmail-connected"><span className="gmail-connected-icon"><Icon name="check" /></span><div><strong>Conectado como {oauthEmail}</strong><small>Los correos se envían desde esta cuenta con el permiso de Google.</small></div><button type="button" className="button button-ghost" onClick={disconnectGmail} disabled={saving}>Desconectar</button></div> : gmailDisponible ? <div className="gmail-connect"><p>Conecta la cuenta de Google del consultorio para enviar confirmaciones, recordatorios y avisos.</p><a className="button button-primary" href="/api/auth/google/gmail"><span className="google-g">G</span> Conectar con Gmail</a><small>Un clic: Google pedirá el permiso. No se guardan contraseñas.</small></div> : <p className="muted-box">El enlace con Google aún no está disponible en esta instalación.</p>) : <button className="button button-primary" onClick={saveEmail} disabled={saving}>Guardar configuración de correo</button>}<div className="email-test-row"><Field label="Enviar correo de prueba a"><input type="email" value={emailForm.correo_prueba || ''} onChange={(e) => setEmailForm({ ...emailForm, correo_prueba: e.target.value })} placeholder="destino@correo.com" /></Field><button className="button button-ghost" onClick={sendTestEmail} disabled={testing}>{testing ? 'Enviando…' : 'Probar envío'}</button></div><div className="email-reminder-row"><Field label="Recordatorios automáticos" hint="Inteligente: pacientes de mañana reciben aviso el día anterior a las 20:00; pacientes de tarde, a las 08:00 del mismo día. O elige horas fijas."><select value={emailReminderHours ?? ''} onChange={(e) => setEmailReminderHours(e.target.value === '' ? null : Number(e.target.value))}><option value="">Inteligente (recomendado)</option><option value={4}>4 horas antes</option><option value={8}>8 horas antes</option><option value={10}>10 horas antes</option><option value={12}>12 horas antes</option><option value={24}>24 horas antes</option><option value={48}>48 horas antes</option></select></Field><button className="button button-ghost" onClick={saveReminderHours} disabled={saving}>Guardar</button></div><div className="email-status"><strong>{statusStrong}</strong><small>{statusSmall}{emailCfg.ultimo_error ? ` Último error: ${emailCfg.ultimo_error}` : ''}</small></div><details className="email-history" open={envios.length > 0}><summary onClick={envios.length === 0 ? loadEnvios : undefined}>Historial de envíos ({envios.length})</summary><div className="email-history-list">{envios.length === 0 ? <small>Sin envíos registrados todavía.</small> : envios.map((item) => <div key={item.id}><span className={`envio-estado ${item.estado}`}>{item.estado === 'enviado' ? '✓' : '✗'}</span><div><strong>{item.tipo}</strong><small>{item.destinatario} · {item.creado_en} {item.error ? `· ${item.error}` : ''}</small></div></div>)}</div></details></section>
    <section className="settings-card hours-card"><div className="settings-card-head"><span><Icon name="clock" /></span><div><h2>Horarios de atención</h2><p>Disponibilidad del doctor actual.</p></div></div><div className="hours-list">{hours.map((item, index) => <div key={item.dia_semana}><label className="mini-toggle"><input type="checkbox" checked={item.activo} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, activo: e.target.checked } : x))} /><i /></label><strong>{item.dia}</strong>{item.activo ? <><input type="time" value={item.hora_inicio} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, hora_inicio: e.target.value } : x))} /><span>a</span><input type="time" value={item.hora_fin} onChange={(e) => setHours(hours.map((x, i) => i === index ? { ...x, hora_fin: e.target.value } : x))} /></> : <em>Cerrado</em>}</div>)}</div><button className="button button-primary" onClick={saveHours} disabled={saving}>Guardar horarios</button></section>
    <section className="settings-card"><div className="settings-card-head"><span><Icon name="qr" /></span><div><h2>QR de pagos</h2><p>Visible para todos tus pacientes.</p></div></div><div className="qr-setting-body">{clinic.qr_url ? <img src={clinic.qr_url} alt="QR del consultorio" /> : <div className="qr-small-placeholder"><Icon name="qr" size={48} /></div>}<label className="file-button"><Icon name="upload" /><span>{qrFile?.name || 'Seleccionar imagen'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setQrFile(e.target.files[0])} /></label></div><button className="button button-primary" onClick={uploadQr} disabled={saving || !qrFile}>Subir QR</button></section>
    <form className="settings-card" onSubmit={(event) => saveClinic(event, ['modo_cobro'])}><div className="settings-card-head"><span><Icon name="wallet" /></span><div><h2>Modo de cobro</h2><p>Cómo cobran tus consultas.</p></div></div><div className="modo-cobro-options">{[['app', 'Cobrar por la app', 'Todo tratamiento exige precio fijo; el paciente lo ve al reservar y el saldo queda registrado.'], ['definir', 'Todo “por definir”', 'Todas las consultas se cobran en el consultorio; el paciente reserva sin ver precios.'], ['mixto', 'Mixto (recomendado)', 'Tratamientos con precio fijo y otros “por definir”, según cada caso.']].map(([value, label, hint]) => <label key={value} className={`modo-option ${(clinic.modo_cobro || 'mixto') === value ? 'selected' : ''}`}><input type="radio" name="modo_cobro" value={value} checked={(clinic.modo_cobro || 'mixto') === value} onChange={(e) => setClinic({ ...clinic, modo_cobro: e.target.value })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div><button className="button button-primary" disabled={saving}>Guardar modo de cobro</button></form>
    <form className="settings-card" onSubmit={sendInvite}><div className="settings-card-head"><span><Icon name="users" /></span><div><h2>Equipo operativo</h2><p>Preautoriza acceso por correo.</p></div></div><Field label="Nombre"><input value={invite.nombre} onChange={(e) => setInvite({ ...invite, nombre: e.target.value })} required /></Field><Field label="Correo"><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></Field><button className="button button-primary" disabled={saving}>Invitar operativo</button><small>{unwrap(usersRemote.data, 'usuarios').filter((item) => item.rol === 'operativo').length} usuarios operativos registrados</small></form>
  </div><Toast message={message} onClose={() => setMessage('')} /></>
}

function ColorField({ label, value, onChange }) {
  return <label className="brand-color"><span>{label}</span><div><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value.toUpperCase()}</code></div></label>
}

function IdentityFile({ label, hint, file, current, onSelect, onRemove, disabled }) {
  return <div className="identity-file"><div><strong>{label}</strong><small>{hint}</small></div><label className="file-button"><Icon name="upload" /><span>{file?.name || (current ? 'Cambiar imagen' : 'Seleccionar imagen')}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onSelect(event.target.files?.[0])} /></label>{file ? <button type="button" className="identity-remove" onClick={() => onSelect(null)} disabled={disabled}>Cancelar</button> : current && <button type="button" className="identity-remove" onClick={onRemove} disabled={disabled}>Quitar</button>}</div>
}

function useFilePreview(file) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!file) { setPreview(''); return undefined }
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result || ''))
    reader.readAsDataURL(file)
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort() }
  }, [file])
  return preview
}
