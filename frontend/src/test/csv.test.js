import { describe, expect, it } from 'vitest'
import { MAX_BATCH, SAMPLE_CSV, decodeCsv, extractInquiries, parseCsv } from '../csv.js'

describe('parseCsv', () => {
  it('쉼표와 줄바꿈으로 나눈다 (윈도우 줄바꿈도)', () => {
    expect(parseCsv('가,나\n다,라')).toEqual([['가', '나'], ['다', '라']])
    expect(parseCsv('가,나\r\n다,라\r\n')).toEqual([['가', '나'], ['다', '라']])
    expect(parseCsv('가,나\r다,라')).toEqual([['가', '나'], ['다', '라']])
  })

  it('따옴표 안의 쉼표, 줄바꿈, 따옴표("")는 글자 그대로 둔다', () => {
    expect(parseCsv('"가, 나",다\n"첫 줄\n둘째 줄","그가 ""안녕""이라 했다"')).toEqual([
      ['가, 나', '다'],
      ['첫 줄\n둘째 줄', '그가 "안녕"이라 했다'],
    ])
  })

  it('마지막 줄에 줄바꿈이 없어도, 빈 칸이 있어도 읽는다', () => {
    expect(parseCsv('가,,다')).toEqual([['가', '', '다']])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('가')).toEqual([['가']])
    expect(parseCsv('가\n\n나')).toEqual([['가'], [''], ['나']])
  })
})

describe('decodeCsv', () => {
  it('UTF-8을 읽고 맨 앞의 BOM은 없앤다', () => {
    const bytes = new TextEncoder().encode('﻿문의\n안녕하세요')
    expect(decodeCsv(bytes)).toBe('문의\n안녕하세요')
    expect(decodeCsv(bytes.buffer)).toBe('문의\n안녕하세요')
  })

  it('UTF-8이 아니면 엑셀이 저장하는 EUC-KR(CP949)로 다시 읽는다', () => {
    // "문의"를 EUC-KR로 저장한 바이트
    expect(decodeCsv(new Uint8Array([0xb9, 0xae, 0xc0, 0xc7]))).toBe('문의')
  })
})

describe('extractInquiries', () => {
  it('머리글이 없으면 첫 번째 칸을 문의로 쓴다', () => {
    const { items, hasHeader } = extractInquiries(parseCsv('첫 문의\n둘째 문의'))
    expect(hasHeader).toBe(false)
    expect(items).toEqual([
      { line: 1, text: '첫 문의' },
      { line: 2, text: '둘째 문의' },
    ])
  })

  it('머리글이 있으면(문의, 내용, text ...) 그 칸을 쓰고 줄 번호는 파일 기준이다', () => {
    const rows = parseCsv('번호,문의,메모\n1,첫 문의,a\n2,둘째 문의,b')
    const { items, hasHeader } = extractInquiries(rows)
    expect(hasHeader).toBe(true)
    expect(items).toEqual([
      { line: 2, text: '첫 문의' },
      { line: 3, text: '둘째 문의' },
    ])
    expect(extractInquiries(parseCsv('Text\nhello')).items).toEqual([{ line: 2, text: 'hello' }])
    expect(extractInquiries(parseCsv('내용\n안녕')).hasHeader).toBe(true)
  })

  it('빈 줄과 문의 칸이 빈 줄은 건너뛰고 몇 개인지 알려 준다', () => {
    const { items, skippedEmpty } = extractInquiries(parseCsv('문의\n가\n\n  \n,메모만 있음\n나'))
    expect(items.map((i) => i.text)).toEqual(['가', '나'])
    expect(skippedEmpty).toBe(3)
  })

  it('문의 안의 줄바꿈은 지키고 앞뒤 공백만 없앤다', () => {
    expect(extractInquiries(parseCsv('"  첫 줄\n둘째 줄  "')).items[0].text).toBe('첫 줄\n둘째 줄')
  })

  it('아무것도 없으면 문의 0개', () => {
    expect(extractInquiries([]).items).toEqual([])
    expect(extractInquiries(parseCsv('문의')).items).toEqual([])
  })

  it('예시 파일은 그대로 읽힌다', () => {
    const { items, hasHeader } = extractInquiries(parseCsv(decodeCsv(new TextEncoder().encode(SAMPLE_CSV))))
    expect(hasHeader).toBe(true)
    expect(items).toHaveLength(3)
    expect(MAX_BATCH).toBe(30)
  })
})
