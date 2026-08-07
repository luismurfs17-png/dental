import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
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
  const navItems = adminOnly
    ? [adminNavItem]
    : [...baseNav.filter((item) => !item.doctorOnly || role === 'doctor'), ...(isAdmin ? [adminNavItem] : [])]
  const mobileItems = adminOnly || isPatient ? navItems : navItems.filter((item) => ['/agenda', '/pacientes', '/cobros', '/notificaciones'].includes(item.to))
  const [mobileMenu, setMobileMenu] = useState(false)

  useEffect(() => setMobileMenu(false), [location.pathname])

  async function logout() {
    try {
      await api('/auth/salir', { method: 'POST' })
    } finally {
      setUser(null)
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="tooth" size={23} /></span><span>SONRIDENT</span></div>
        <div className="clinic-chip">
          <span>{(user?.consultorio?.nombre || (adminOnly ? 'Administración' : 'Mi consultorio')).slice(0, 1)}</span>
          <div><strong>{user?.consultorio?.nombre || (adminOnly ? 'Administración' : 'Mi consultorio')}</strong><small>{isPatient ? 'Portal del paciente' : adminOnly ? 'Superadministración' : role === 'doctor' ? 'Cuenta médica' : 'Equipo operativo'}</small></div>
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
          <div className="brand"><span className="brand-mark"><Icon name="tooth" size={19} /></span><span>SONRIDENT</span></div>
          <div className="mobile-top-actions"><NavLink className="notification-button" to={isPatient ? '/historia' : '/notificaciones'} aria-label="Notificaciones"><Icon name="bell" /></NavLink><button className="notification-button" onClick={() => setMobileMenu(true)} aria-label="Abrir menú"><Icon name="menu" /></button></div>
        </div>
        <main key={location.pathname} className="main-content"><Outlet /></main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación móvil">
        {mobileItems.map((item) => <NavItem key={item.to} item={item} mobile />)}
        {!isPatient && <button className="mobile-more" onClick={() => setMobileMenu(true)}><span className="nav-icon"><Icon name="menu" size={21} /></span><span>Más</span></button>}
      </nav>
      {mobileMenu && <div className="mobile-menu-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMobileMenu(false)}><section className="mobile-menu" role="dialog" aria-modal="true" aria-label="Menú de navegación"><header><div><small>SONRIDENT</small><strong>{user?.nombre || 'Usuario'}</strong></div><button className="icon-button" onClick={() => setMobileMenu(false)} aria-label="Cerrar menú"><Icon name="close" /></button></header><nav>{navItems.map((item) => <NavItem key={item.to} item={item} />)}</nav><button className="mobile-logout" onClick={logout}><Icon name="logout" /> Cerrar sesión</button></section></div>}
    </div>
  )
}

function NavItem({ item, mobile = false }) {
  return <NavLink to={item.to} className={({ isActive }) => `${item.featured ? 'nav-featured ' : ''}${isActive ? 'active' : ''}`}><span className="nav-icon"><Icon name={item.icon} size={mobile ? 21 : 19} /></span><span>{item.label}</span></NavLink>
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
}
