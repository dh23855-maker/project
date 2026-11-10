import { useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { PillMark, useSlidingPill } from './SlidingPill.jsx'

// 모든 화면 위쪽: 이름(누르면 상담 화면), 메뉴, 지금 로그인한 상담사, 로그아웃
export default function Layout() {
  const { agent, logout } = useAuth()
  const navRef = useRef(null)
  const { pathname } = useLocation()
  const { box, animate } = useSlidingPill(navRef, 'a.active', pathname)
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="CSFlow 상담 화면으로 이동">
          CSFlow
        </Link>
        <nav aria-label="메뉴" ref={navRef}>
          <PillMark box={box} animate={animate} className="nav-pill" />
          <NavLink to="/" end>
            상담
          </NavLink>
          <NavLink to="/logs">작업 기록</NavLink>
          <NavLink to="/stats">문의 현황</NavLink>
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
