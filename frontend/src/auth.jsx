import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, setUnauthorizedHandler } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [agent, setAgent] = useState(null)
  const [ready, setReady] = useState(false) // 로그인 상태 확인이 끝났는지
  const [connectionError, setConnectionError] = useState('') // 로그인과 상관없이 서버에 연결하지 못했을 때의 안내

  useEffect(() => {
    setUnauthorizedHandler(() => setAgent(null))
    api
      .me()
      .then(setAgent)
      .catch((e) => {
        setAgent(null)
        if (e.status !== 401) setConnectionError(e.message) // 401은 그냥 로그인 전이라는 뜻
      })
      .finally(() => setReady(true))
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (username, password) => {
    const result = await api.login(username, password)
    setConnectionError('')
    setAgent(result.agent)
    return result.agent
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setAgent(null)
    }
  }, [])

  const value = useMemo(
    () => ({ agent, ready, connectionError, login, logout }),
    [agent, ready, connectionError, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider 안에서 써야 합니다.')
  return value
}
