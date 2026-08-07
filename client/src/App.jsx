import { useContext, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api } from './lib/api.js'
import { AuthContext } from './context/AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import { ErrorState, Loading } from './components/UI.jsx'
import Icon from './components/Icon.jsx'
import Login, { homeFor } from './pages/Login.jsx'
import AuthSuccess from './pages/AuthSuccess.jsx'
import Onboarding from './pages/Onboarding.jsx'
import AdminPanel from './pages/admin/AdminPanel.jsx'
import { BookAppointment, PatientAppointments, PatientDashboard, PatientHealth, PatientPayments } from './pages/patient/PatientPages.jsx'
import { Agenda, Notifications, Patients, PaymentsDesk, Services } from './pages/team/TeamPages.jsx'
import PatientDetail from './pages/team/PatientDetail.jsx'
import Settings from './pages/team/Settings.jsx'
import Audit from './pages/team/Audit.jsx'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadSession() {
    setLoading(true); setError('')
    try {
      const response = await api('/auth/yo')
      setUser(response?.usuario || response)
    } catch (requestError) {
      if (requestError.status !== 401) setError(requestError.message)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSession() }, [])

  if (loading) return <div className="boot-screen"><div className="brand boot-brand"><span className="brand-mark"><Icon name="tooth" size={23} /></span><span>SONRIDENT</span></div><Loading label="Abriendo tu espacio" /></div>
  if (error && !user) return <div className="boot-screen"><ErrorState message={error} onRetry={loadSession} /></div>

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/success" element={<AuthSuccess />} />
        <Route path="/crear-consultorio" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/inicio" element={<RoleRoute allow={['paciente']}><PatientDashboard /></RoleRoute>} />
          <Route path="/reservar" element={<RoleRoute allow={['paciente']}><BookAppointment /></RoleRoute>} />
          <Route path="/citas" element={<RoleRoute allow={['paciente']}><PatientAppointments /></RoleRoute>} />
          <Route path="/pagos" element={<RoleRoute allow={['paciente']}><PatientPayments /></RoleRoute>} />
          <Route path="/historia" element={<RoleRoute allow={['paciente']}><PatientHealth /></RoleRoute>} />
          <Route path="/agenda" element={<RoleRoute allow={['doctor', 'operativo']}><Agenda /></RoleRoute>} />
          <Route path="/pacientes" element={<RoleRoute allow={['doctor', 'operativo']}><Patients /></RoleRoute>} />
          <Route path="/pacientes/:id" element={<RoleRoute allow={['doctor', 'operativo']}><PatientDetail /></RoleRoute>} />
          <Route path="/servicios" element={<RoleRoute allow={['doctor']}><Services /></RoleRoute>} />
          <Route path="/cobros" element={<RoleRoute allow={['doctor', 'operativo']}><PaymentsDesk /></RoleRoute>} />
          <Route path="/notificaciones" element={<RoleRoute allow={['doctor', 'operativo']}><Notifications /></RoleRoute>} />
          <Route path="/configuracion" element={<RoleRoute allow={['doctor']}><Settings /></RoleRoute>} />
          <Route path="/auditoria" element={<RoleRoute allow={['doctor']}><Audit /></RoleRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />
        </Route>
        <Route path="*" element={<Navigate to={user ? homeFor(user) : '/login'} replace />} />
      </Routes>
    </AuthContext.Provider>
  )
}

function RequireAuth({ children }) {
  const location = useLocation()
  const context = ReactContextValue()
  if (!context.user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

function RoleRoute({ allow, children }) {
  const { user } = ReactContextValue()
  const role = user?.rol || user?.role
  return allow.includes(role) ? children : <Navigate to={homeFor(user)} replace />
}

function AdminRoute({ children }) {
  const { user } = ReactContextValue()
  return user?.es_admin ? children : <Navigate to={homeFor(user)} replace />
}

function ReactContextValue() {
  // Kept local to avoid coupling guards to page components.
  return useContext(AuthContext)
}
