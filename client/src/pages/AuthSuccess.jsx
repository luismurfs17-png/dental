import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { homeFor } from './Login.jsx'
import { Loading } from '../components/UI.jsx'

export default function AuthSuccess() {
  const { user, setUser } = useAuth()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const clinic = searchParams.get('clinica')

  useEffect(() => {
    if (clinic) sessionStorage.setItem('clinic_portal_slug', clinic)
  }, [clinic])

  useEffect(() => {
    let active = true
    async function checkSession(attempt = 0) {
      try {
        const response = await api('/auth/yo')
        const nextUser = response?.usuario || response
        if (!active) return
        if (!nextUser?.id) {
          setError('No se pudo recuperar la sesión')
          setDone(true)
          return
        }
        setUser(nextUser)
        setDone(true)
      } catch (requestError) {
        if (!active) return
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
          if (!active) return
          return checkSession(attempt + 1)
        }
        setError(requestError.message || 'La sesión no es válida')
        setDone(true)
      }
    }
    checkSession()
    return () => { active = false }
  }, [setUser])

  if (!done && !user) return <Loading label="Iniciando sesión…" />
  if (user) return <Navigate to={homeFor(user)} replace />
  const inClinicApp = /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/|$)/.test(window.location.pathname)
  const loginPath = inClinicApp ? '/' : clinic ? `/c/${encodeURIComponent(clinic)}` : '/login'
  return <Navigate to={`${loginPath}?error=${encodeURIComponent(error || 'No se pudo iniciar sesión')}`} replace />
}
