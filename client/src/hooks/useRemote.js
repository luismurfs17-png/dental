import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'

export function useRemote(path, { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!enabled || !path) return
    setLoading(true)
    setError('')
    try {
      setData(await api(path))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [enabled, path])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, setData, loading, error, reload }
}
