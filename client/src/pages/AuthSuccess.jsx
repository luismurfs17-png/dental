import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Loading } from '../components/UI.jsx'

export default function AuthSuccess() {
  const { setUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await api('/auth/yo')
        if (response?.usuario) {
          setUser(response.usuario)
          const user = response.usuario
          const hasClinic = Boolean(user.consultorio_id)
          if (user.es_admin && !hasClinic) {
            navigate('/admin', { replace: true })
          } else if (user.rol === 'doctor' && !hasClinic) {
            navigate('/crear-consultorio', { replace: true })
          } else {
            navigate('/agenda', { replace: true })
          }
        } else {
          navigate('/login', { replace: true })
        }
      } catch (error) {
        navigate('/login', { replace: true })
      }
    }
    checkSession()
  }, [setUser, navigate])

  return <Loading label="Iniciando sesión..." />
}
