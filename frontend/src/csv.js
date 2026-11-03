// 문의 CSV 파일 읽기: 인코딩 판별, 표 나누기, 문의 칸 찾기.

export const MAX_BATCH = 30 // 한 번에 올릴 수 있는 문의 수
export const MAX_FILE_BYTES = 1024 * 1024 // 1MB
export const MAX_LENGTH = 1000 // 문의 한 개의 최대 글자 수 (서버와 같다)

// 머리글로 인정하는 이름 (첫 줄이 이 중 하나이면 머리글로 보고 그 칸을 문의로 쓴다)
const HEADER_NAMES = ['문의', '문의 내용', '문의내용', '내용', '질문', 'text', 'body', 'inquiry', 'question', 'message']

// 엑셀의 "CSV(쉼표로 분리)"는 한국어 윈도우에서 EUC-KR(CP949)로 저장된다. UTF-8이 아니면 EUC-KR로 다시 읽는다.
export function decodeCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      text = new TextDecoder('euc-kr').decode(bytes)
    } catch {
      text = new TextDecoder('utf-8').decode(bytes)
    }
  }
  return text.replace(/^﻿/, '')
}

// 따옴표로 감싼 칸 안의 쉼표·줄바꿈·"" (따옴표 하나)을 지켜서 [[칸, 칸], ...]로 나눈다
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === ',') {
      endCell()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

// 표에서 문의 목록을 뽑는다.
// - 첫 줄이 머리글(문의, 내용, text ...)이면 그 칸을, 아니면 첫 번째 칸을 문의로 쓴다.
// - 빈 칸은 건너뛰고 몇 개를 건너뛰었는지 알려 준다.
// 돌려주는 값: { items: [{ line(파일의 몇 번째 줄), text }], skippedEmpty, hasHeader }
export function extractInquiries(rows) {
  let column = 0
  let start = 0
  let hasHeader = false
  if (rows.length > 0) {
    const names = rows[0].map((c) => c.trim().toLowerCase())
    const found = names.findIndex((n) => HEADER_NAMES.includes(n))
    if (found !== -1) {
      column = found
      start = 1
      hasHeader = true
    }
  }
  const items = []
  let skippedEmpty = 0
  for (let i = start; i < rows.length; i++) {
    const text = (rows[i][column] ?? '').trim()
    if (rows[i].every((c) => c.trim() === '')) {
      skippedEmpty++ // 완전히 빈 줄
    } else if (!text) {
      skippedEmpty++ // 문의 칸이 빈 줄
    } else {
      items.push({ line: i + 1, text })
    }
  }
  return { items, skippedEmpty, hasHeader }
}

// 파일을 바이트로 읽는다 (브라우저와 시험 환경 모두에서 동작하도록 FileReader를 쓴다)
export function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'))
    reader.readAsArrayBuffer(file)
  })
}

// 예시 파일 내용 (엑셀에서 한글이 깨지지 않도록 앞에 BOM을 붙인다)
export const SAMPLE_CSV = '﻿문의\n' +
  '"어제 시킨 운동화가 아직 안 왔어요. 언제쯤 받을 수 있나요?"\n' +
  '"쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요?"\n' +
  '"판매 대금은 검수 합격하고 언제 입금되나요?"\n'
