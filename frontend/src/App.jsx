import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import EvaluationPage from './pages/EvaluationPage.jsx'
import ConsultPage from './pages/ConsultPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import LogsPage from './pages/LogsPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

// 로그인하지 않았으면 어떤 화면이든 로그인 화면으로 보낸다
function RequireLogin() {
  const { agent, ready } = useAuth()
  if (!ready) return <p className="muted pad">확인하는 중...</p>
  if (!agent) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireLogin />}>
          <Route path="/" element={<ConsultPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/evaluation" element={<EvaluationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
