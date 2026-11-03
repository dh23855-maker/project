import { useLayoutEffect, useRef, useState } from 'react'

// 선택된 항목 뒤에서 미끄러지듯 움직이는 알약(상단 메뉴, 상태 탭, 기간 탭이 함께 쓴다)의 위치를 잰다.
// - containerRef: 알약이 들어갈 칸(position이 relative 또는 absolute여야 한다)
// - selector: 칸 안에서 지금 선택된 항목을 찾는 선택자
// - selectedKey: 선택이 바뀌면 값이 바뀐다
// 처음 그릴 때와 창/칸 크기가 바뀔 때는 움직임 없이 제자리를 잡고, 선택이 바뀔 때만 부드럽게 옮겨 간다.
export function useSlidingPill(containerRef, selector, selectedKey) {
  const [box, setBox] = useState(null)
  const [animate, setAnimate] = useState(false)
  const firstRun = useRef(true)

  const measure = () => {
    const active = containerRef.current?.querySelector(selector)
    setBox(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
  }

  // 선택이 바뀌면 새 위치를 재고, 첫 그림이 아니면 움직임을 켠다
  useLayoutEffect(() => {
    setAnimate(!firstRun.current)
    firstRun.current = false
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  // 창이나 칸 너비가 바뀌거나(예: 목록 너비 조절) 글꼴이 늦게 불러와져 글자 너비가 바뀌면 움직임 없이 다시 잰다.
  // 선택이 바뀐 직후의 움직임을 끊지 않도록 선택 처리와 따로 둔다.
  useLayoutEffect(() => {
    const container = containerRef.current
    const remeasure = () => {
      setAnimate(false)
      measure()
    }
    window.addEventListener('resize', remeasure)
    document.fonts?.ready.then(remeasure)
    let observer = null
    if (typeof ResizeObserver === 'function' && container) {
      let seenFirst = false // 지켜보기 시작할 때 오는 첫 알림은 크기가 바뀐 것이 아니므로 넘긴다
      observer = new ResizeObserver(() => {
        if (seenFirst) remeasure()
        seenFirst = true
      })
      observer.observe(container)
    }
    return () => {
      window.removeEventListener('resize', remeasure)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, selector])

  return { box, animate }
}

export function PillMark({ box, animate, className = '' }) {
  if (!box) return null
  return (
    <span
      className={`slide-pill ${className} ${animate ? 'animate' : ''}`}
      style={{ width: box.width, transform: `translateX(${box.left}px)` }}
      aria-hidden="true"
    />
  )
}
