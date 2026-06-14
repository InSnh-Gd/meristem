import type { createPolicyApp } from './app.ts'

// M-Policy Eden app 类型通过公共 type-only 入口暴露，避免跨服务读取内部 app 文件。
export type PolicyApp = ReturnType<typeof createPolicyApp>
