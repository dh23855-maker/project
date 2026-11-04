import { useEffect, useRef, useState } from 'react'

// 브라우저 기본 선택 상자 대신 쓰는 부드러운 선택 메뉴 (캘린더 창과 같은 모양: 둥근 흰 상자, 그림자, 같은 글꼴).
// - options: [{ value, label }]  - label: 화면 읽기 프로그램이 읽는 이름 (예: "정렬")
// - variant: 'pill'(작은 알약, 목록 위 정렬) | 'box'(일반 입력칸 크기)   - align: 메뉴를 열 때 맞출 쪽 ('left' | 'right')
// 키보드: ↑ ↓ 로 열고 옮기기, Home/End, Enter·Space로 고르기, Esc로 닫기(고르지 않음), Tab으로 나가면 닫힘.
export default function SelectMenu({ value, onChange, options, label, variant = 'box', align = 'left', className = '' }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const trigger = useRef(null)
  const list = useRef(null)
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => {
      if (wrap.current && !wrap.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  // 열리면 지금 고른 항목에 초점을 둔다 (키보드로 바로 옮길 수 있게)
  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.focus()
  }, [open])

  function close(refocus) {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  function choose(next) {
    onChange(next)
    close(true)
  }

  function triggerKey(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  function listKey(event) {
    const items = [...list.current.querySelectorAll('[role="option"]')]
    const index = items.indexOf(document.activeElement)
    const go = (target) => {
      event.preventDefault()
      items[(target + items.length) % items.length].focus()
    }
    if (event.key === 'ArrowDown') go(index + 1)
    else if (event.key === 'ArrowUp') go(index - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(items.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }

  return (
    <div className={`select-menu select-menu-${variant} ${className}`} ref={wrap}>
      <button
        type="button"
        ref={trigger}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="select-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={triggerKey}
      >
        <span>{current?.label}</span>
        <svg className="select-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={`select-pop select-pop-${align}`} role="listbox" aria-label={label} ref={list} onKeyDown={listKey}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === current?.value}
              tabIndex={-1}
              className="select-option"
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === current?.value && (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="m3 7.5 2.7 2.7L11 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
