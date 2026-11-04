import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SelectMenu from '../components/SelectMenu.jsx'
import { agent, mockServer, renderApp } from './utils.jsx'

const OPTIONS = [
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
  { value: 'other', label: '다른 순서' },
]

function Harness({ onChange = () => {}, initial = 'newest' }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <SelectMenu
        label="정렬"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <button type="button">바깥 단추</button>
    </div>
  )
}

const trigger = () => screen.getByRole('combobox', { name: '정렬' })
const options = () => screen.getAllByRole('option')

describe('선택 메뉴 (정렬, 작업 기록 필터)', () => {
  it('처음에는 고른 항목만 보이고 메뉴는 닫혀 있다', () => {
    render(<Harness />)
    expect(trigger()).toHaveTextContent('최신순')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('누르면 모든 항목이 있는 메뉴가 열리고 지금 고른 항목에 표시가 있다', async () => {
    render(<Harness initial="oldest" />)
    await userEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    const list = within(screen.getByRole('listbox', { name: '정렬' }))
    expect(list.getAllByRole('option').map((o) => o.textContent)).toEqual(['최신순', '오래된순', '다른 순서'])
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(screen.getByRole('option', { name: '오래된순' }).querySelector('svg')).not.toBeNull() // 체크 표시
    expect(screen.getByRole('option', { name: '최신순' }).querySelector('svg')).toBeNull()
  })

  it('항목을 누르면 값이 바뀌고 메뉴가 닫히며, 초점이 다시 단추로 돌아온다', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('option', { name: '오래된순' }))
    expect(onChange).toHaveBeenCalledWith('oldest')
    expect(trigger()).toHaveTextContent('오래된순')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('같은 단추를 다시 누르거나 바깥을 누르면 아무것도 고르지 않고 닫힌다', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(trigger())
    await userEvent.click(trigger())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('button', { name: '바깥 단추' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('키보드: ↓로 열고 지금 항목에 초점이 가며, ↓ ↑ Home End로 옮기고 Enter로 고른다', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    trigger().focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '최신순' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: '오래된순' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('option', { name: '다른 순서' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}') // 끝에서 다시 처음으로
    expect(screen.getByRole('option', { name: '최신순' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}') // 처음에서 끝으로
    expect(screen.getByRole('option', { name: '다른 순서' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('option', { name: '최신순' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('oldest')
    expect(trigger()).toHaveTextContent('오래된순')
    expect(trigger()).toHaveFocus()
  })

  it('Esc는 고르지 않고 닫으며 초점을 단추로 돌려준다', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(trigger())
    await userEvent.keyboard('{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger()).toHaveTextContent('최신순')
  })

  it('Tab으로 메뉴를 벗어나면 닫힌다', async () => {
    render(<Harness />)
    await userEvent.click(trigger())
    await userEvent.keyboard('{Tab}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('모양: 캘린더 창과 같은 둥근 흰 상자와 그림자를 쓰고, 글자는 기본 상자가 아니라 같은 글꼴을 따른다', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    const rule = (selector) => css.match(new RegExp(`${selector.replace('.', '\\.')} \\{[^}]*\\}`))[0]
    const shadow = (text) => text.match(/box-shadow: ([^;]+);/)[1]
    expect(shadow(rule('.select-pop'))).toBe(shadow(rule('.calendar-pop')))
    expect(rule('.select-pop')).toMatch(/border-radius: 1[68]px/)
    expect(rule('.select-pop')).toMatch(/background: var\(--surface\)/)
    expect(rule('.select-trigger')).toMatch(/font: inherit/)
    expect(rule('.select-option')).toMatch(/font: inherit/)
    expect(rule('.select-option')).toMatch(/border-radius: 10px/)
  })
})

describe('작업 기록 필터는 선택 메뉴를 쓰고, 시간·상담사·행동·자세히 칸은 글자가 꺾이지 않는다', () => {
  const row = (id) => ({
    id,
    created_at: '2026-11-02T10:00:00+09:00',
    action: 'approve',
    action_ko: '승인',
    inquiry_id: id,
    draft_text: '초안',
    new_draft_text: null,
    final_reply: '초안',
    agent_username: 'lee',
    agent_name: '이상담',
    inquiry_body: '아주 긴 문의 내용입니다 '.repeat(8),
  })

  it('필터는 상담사 / 행동 선택 메뉴이고 "전체"가 처음 값이다', async () => {
    mockServer({ 'GET /api/auth/me': agent, 'GET /api/action-logs': [row(1)] })
    renderApp('/logs')
    await screen.findByRole('table')
    expect(screen.getByRole('combobox', { name: '상담사' })).toHaveTextContent('전체')
    expect(screen.getByRole('combobox', { name: '행동' })).toHaveTextContent('전체')
    await userEvent.click(screen.getByRole('combobox', { name: '행동' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['전체', '승인', '수정', '재작성', '직접 작성'])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('combobox', { name: '상담사' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['전체', '김상담', '박상담', '이상담'])
  })

  it('긴 문의 칸을 뺀 나머지 칸에는 줄바꿈 금지(nowrap)가 붙어 있다', async () => {
    mockServer({ 'GET /api/auth/me': agent, 'GET /api/action-logs': [row(1)] })
    renderApp('/logs')
    const table = await screen.findByRole('table')
    const body = within(table).getAllByRole('row')[1]
    const cells = [...body.children]
    expect(cells.map((c) => c.classList.contains('nowrap'))).toEqual([true, true, true, false, true]) // 시간, 상담사, 행동, 문의, 자세히
    expect(within(table).getAllByRole('columnheader').map((c) => c.classList.contains('nowrap'))).toEqual([true, true, true, false, true])
    expect(within(body).getByRole('button', { name: '자세히' }).closest('td')).toHaveClass('nowrap')
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    expect(css).toMatch(/\.table \.nowrap \{\s*white-space: nowrap;/)
  })
})
