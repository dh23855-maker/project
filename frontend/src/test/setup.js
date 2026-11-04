import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// 컴퓨터가 바쁠 때(개발 서버·브라우저가 함께 돌 때) 화면이 늦게 그려져 기본 1초를 넘기며 우연히 실패하는 일을 막는다.
// 제대로 동작하는 시험은 이 시간을 다 쓰지 않고 바로 끝난다.
configure({ asyncUtilTimeout: 4000 })
