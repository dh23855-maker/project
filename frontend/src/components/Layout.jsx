import { useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

// 선택된 메뉴 뒤에서 미끄러지듯 움직이는 알약의 위치를 잰다.
// Layout 안에서 재야 nav의 ref가 붙은 뒤에 잴 수 있다. 처음 그릴 때는 움직이지 않고(transition 없음),
// 메뉴를 바꿀 때만 부드럽게 옮겨 간다.
function useNavPill(navRef) {
  const location = useLocation()
  const [box, setBox] = useState(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const active = navRef.current?.querySelector('a.active')
      setBox(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
    }
    measure()
    window.addEventListener('resize', measure)
    // 글꼴이 늦게 불러와져 글자 너비가 바뀌면 다시 잰다
    document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [location.pathname, navRef])

  useLayoutEffect(() => {
    // 첫 위치를 잡은 다음 그림부터 움직임을 켠다
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return { box, animate }
}

// 모든 화면 위쪽: 이름(누르면 상담 화면), 메뉴, 지금 로그인한 상담사, 로그아웃
export default function Layout() {
  const { agent, logout } = useAuth()
  const navRef = useRef(null)
  const { box, animate } = useNavPill(navRef)
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="고동동 CS 상담 화면으로 이동">
          고동동 CS
        </Link>
        <nav aria-label="메뉴" ref={navRef}>
          {box && (
            <span
              className={`nav-pill ${animate ? 'animate' : ''}`}
              style={{ width: box.width, transform: `translateX(${box.left}px)` }}
              aria-hidden="true"
            />
          )}
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
