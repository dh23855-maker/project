import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

// 모든 화면 위쪽: 메뉴, 지금 로그인한 상담사, 로그아웃
export default function Layout() {
  const { agent, logout } = useAuth()
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">고동동 CS</span>
        <nav aria-label="메뉴">
          <NavLink to="/" end>
            상담
          </NavLink>
          <NavLink to="/logs">작업 기록</NavLink>
          <NavLink to="/stats">문의 현황</NavLink>
          <NavLink to="/evaluation">성능 평가</NavLink>
          <NavLink to="/settings">설정</NavLink>
        </nav>
        <span className="spacer" />
        <span className="who" aria-label="로그인한 상담사">
          {agent?.display_name}
        </span>
        <button type="button" className="btn btn-small" onClick={logout}>
          로그아웃
        </button>
      </header>
      <div className="content">
        <Outlet />
      </div>
    </div>
  )
}
