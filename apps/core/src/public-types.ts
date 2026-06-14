import type { createCoreApp } from './app.ts'

// Core Eden app 类型通过公共 type-only 入口暴露，避免其他包直接依赖内部 app 模块。
export type CoreApp = ReturnType<typeof createCoreApp>
