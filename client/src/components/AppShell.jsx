import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { clinicBrand, clinicTheme } from '../lib/branding.js'
import { useAuth } from '../context/AuthContext.jsx'
import Icon from './Icon.jsx'

const patientNav = [
  { to: '/inicio', label: 'Inicio', icon: 'home' },
  { to: '/reservar', label: 'Reservar', icon: 'plus', featured: true },
  { to: '/citas', label: 'Mis citas', icon: 'calendar' },
  { to: '/pagos', label: 'Pagos', icon: 'wallet' },
  { to: '/historia', label: 'Mi salud', icon: 'tooth' },
]

const teamNav = [
  { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/pacientes', label: 'Pacientes', icon: 'users' },
  { to: '/servicios', label: 'Tratamientos', icon: 'tooth', doctorOnly: true },
  { to: '/presupuestos', label: 'Cotizaciones', icon: 'file' },
  { to: '/cobros', label: 'Caja y pagos', icon: 'wallet' },
  { to: '/notificaciones', label: 'Avisos', icon: 'bell' },
  { to: '/configuracion', label: 'Consultorio', icon: 'settings', doctorOnly: true },
  { to: '/auditoria', label: 'Auditoría', icon: 'history', doctorOnly: true },
]

const adminNavItem = { to: '/admin', label: 'Administrar', icon: 'settings' }

export default function AppShell() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const role = user?.rol || user?.role
  const isPatient = role === 'paciente'
  const isAdmin = Boolean(user?.es_admin)
  const hasClinic = Boolean(user?.consultorio || user?.consultorioId || user?.consultorio_id)
  const adminOnly = isAdmin && !hasClinic
  const baseNav = isPatient ? patientNav : teamNav
  const inClinicApp = /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/|$)/.test(window.location.pathname)
  const navItems = adminOnly
    ? [adminNavItem]
    : [...baseNav.filter((item) => !item.doctorOnly || role === 'doctor'), ...(isAdmin && !inClinicApp ? [adminNavItem] : [])]
  const mobileItems = adminOnly || isPatient ? navItems : navItems.filter((item) => ['/agenda', '/pacientes', '/presupuestos', '/cobros', '/notificaciones'].includes(item.to))
  const [mobileMenu, setMobileMenu] = useState(false)
  const clinicId = user?.consultorioId || user?.consultorio_id
  const inAdminArea = location.pathname.startsWith('/admin')
  const brandedClinic = hasClinic && !inAdminArea ? user?.consultorio : null
  const brand = clinicBrand(brandedClinic)
  const theme = clinicTheme(brandedClinic)

  useEffect(() => setMobileMenu(false), [location.pathname])
  useEffect(() => {
    if (!clinicId) return undefined
    let active = true
    api('/consultorio')
      .then((response) => {
        if (!active || !response?.consultorio) return
        setUser((current) => current ? { ...current, consultorio: response.consultorio } : current)
      })
      .catch(() => {})
    return () => { active = false }
  }, [clinicId, setUser])
  useEffect(() => {
    const root = document.documentElement
    const themeColor = document.querySelector('meta[name="theme-color"]')
    const previousTitle = document.title
    const previousThemeColor = themeColor?.getAttribute('content')
    const previous = Object.fromEntries(Object.keys(theme).map((property) => [property, root.style.getPropertyValue(property)]))
    for (const [property, value] of Object.entries(theme)) root.style.setProperty(property, value)
    document.title = brand.name
    if (themeColor) themeColor.setAttribute('content', brand.primary)
    return () => {
      for (const [property, value] of Object.entries(previous)) {
        if (value) root.style.setProperty(property, value)
        else root.style.removeProperty(property)
      }
      document.title = previousTitle
      if (themeColor && previousThemeColor) themeColor.setAttribute('content', previousThemeColor)
    }
  }, [brand.name, brand.primary, brand.accent, brand.background, brand.backgroundImage, brand.backgroundOpacity])
  useEffect(() => {
    const manifest = document.getElementById('app-manifest')
    const appleIcon = document.getElementById('apple-touch-icon')
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (!manifest || !appleIcon) return undefined
    const previousManifest = manifest.getAttribute('href')
    const previousRel = manifest.getAttribute('rel')
    const previousIcon = appleIcon.getAttribute('href')
    const previousTitle = appleTitle?.getAttribute('content')
    if (brandedClinic?.manifest_url) { manifest.setAttribute('href', brandedClinic.manifest_url); manifest.setAttribute('rel', 'manifest') }
    if (brandedClinic?.slug) appleIcon.setAttribute('href', `/api/publico/clinicas/${brandedClinic.slug}/icon/180.png`)
    if (appleTitle && brandedClinic) appleTitle.setAttribute('content', brand.name)
    return () => {
      if (previousManifest) manifest.setAttribute('href', previousManifest)
      else manifest.removeAttribute('href')
      if (previousRel) manifest.setAttribute('rel', previousRel)
      else manifest.removeAttribute('rel')
      if (previousIcon) appleIcon.setAttribute('href', previousIcon)
      if (appleTitle && previousTitle) appleTitle.setAttribute('content', previousTitle)
    }
  }, [brand.name, brandedClinic, brandedClinic?.manifest_url, brandedClinic?.slug])
  useEffect(() => {
    if (brandedClinic?.slug) sessionStorage.setItem('clinic_portal_slug', brandedClinic.slug)
    else if (inAdminArea) sessionStorage.removeItem('clinic_portal_slug')
  }, [brandedClinic?.slug, inAdminArea])

  async function logout() {
    try {
      await api('/auth/salir', { method: 'POST' })
    } finally {
      setUser(null)
      navigate(inClinicApp ? '/' : '/login', { replace: true })
    }
  }

  return (
    <div className="app-shell" style={theme}>
      <aside className="sidebar">
        <Brand brand={brand} iconSize={23} />
        <div className="clinic-chip">
          <span>{(user?.consultorio?.nombre || (adminOnly ? 'Administración' : 'Mi consultorio')).slice(0, 1)}</span>
          <div><strong>{user?.consultorio?.nombre || (adminOnly ? 'Administración' : 'Mi consultorio')}</strong><small>{isPatient ? 'Portal del paciente' : adminOnly ? 'Superadministración' : role === 'doctor' ? 'Cuenta médica' : 'Equipo operativo'}</small>{brand.eslogan && <em className="clinic-eslogan">{brand.eslogan}</em>}</div>
        </div>
        <nav className="side-nav" aria-label="Navegación principal">
          <small>ESPACIO DE TRABAJO</small>
          {navItems.map((item) => <NavItem key={item.to} item={item} />)}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials(user?.nombre || user?.name)}</span>
          <div><strong>{user?.nombre || user?.name || 'Usuario'}</strong><small>{user?.email}</small></div>
          <button onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" /></button>
        </div>
      </aside>

      <div className="workspace">
        <div className="mobile-topbar">
          <Brand brand={brand} iconSize={19} />
          <div className="mobile-top-actions"><NavLink className="notification-button" to={isPatient ? '/historia' : '/notificaciones'} aria-label="Notificaciones"><Icon name="bell" /></NavLink><button className="notification-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menú"><Icon name="menu" /></button></div>
        </div>
        <main key={location.pathname} className={`main-content ${brand.whatsapp ? 'has-whatsapp' : ''}`}><Outlet /></main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación móvil">
        {mobileItems.map((item) => <NavItem key={item.to} item={item} mobile />)}
        {!isPatient && <button className="mobile-more" onClick={() => setMobileMenu(true)}><span className="nav-icon"><Icon name="menu" size={21} /></span><span>Más</span></button>}
      </nav>
      {brandedClinic && brand.whatsapp && <a className="whatsapp-float" href={`https://wa.me/${brand.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" aria-label="Escribir por WhatsApp"><Icon name="whatsapp" size={26} /></a>}
      {mobileMenu && createPortal(<div className="mobile-menu-backdrop" style={theme} onClick={(event) => event.target === event.currentTarget && setMobileMenu(false)}><section className="mobile-menu" role="dialog" aria-modal="true" aria-label="Menú de navegación"><header><div><small>{brand.eslogan || brand.name}</small><strong>{user?.nombre || 'Usuario'}</strong></div><button className="icon-button" onClick={() => setMobileMenu(false)} aria-label="Cerrar menú"><Icon name="close" /></button></header><nav>{navItems.map((item) => <NavItem key={item.to} item={item} />)}</nav><button className="mobile-logout" onClick={logout}><Icon name="logout" /> Cerrar sesión</button></section></div>, document.body)}
    </div>
  )
}

function Brand({ brand, iconSize }) {
  return <div className="brand"><span className={`brand-mark ${brand.logo ? 'has-logo' : ''}`}>{brand.logo ? <img src={brand.logo} alt="" /> : <Icon name="tooth" size={iconSize} />}</span><span>{brand.name}</span></div>
}

function NavItem({ item, mobile = false }) {
  return <NavLink to={item.to} className={({ isActive }) => `${item.featured ? 'nav-featured ' : ''}${isActive ? 'active' : ''}`}><span className="nav-icon"><Icon name={item.icon} size={mobile ? 21 : 19} /></span><span>{item.label}</span></NavLink>
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
}
