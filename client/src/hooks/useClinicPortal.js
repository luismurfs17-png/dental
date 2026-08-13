import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

export function useClinicPortal(slug) {
  const [clinic, setClinic] = useState(null)
  const [loading, setLoading] = useState(Boolean(slug))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) { setClinic(null); setLoading(false); setError(''); return undefined }
    let active = true
    setLoading(true)
    setError('')
    api(`/publico/clinicas/${encodeURIComponent(slug)}`)
      .then((response) => { if (active) setClinic(response.consultorio) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [slug])

  return { clinic, loading, error }
}
