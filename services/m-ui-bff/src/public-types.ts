import type { createMUiBffApp } from './app.ts'

// M-UI BFF Eden app 类型通过公共 type-only 入口暴露，避免跨包直接依赖内部 app 模块。
export type MUiBffApp = ReturnType<typeof createMUiBffApp>
