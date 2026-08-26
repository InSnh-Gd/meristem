// 兼容入口仅重新导出强制 Relay 决策与执行职责模块，保持既有消费者的导入路径稳定。
export * from './forced-relay-types.ts'
export * from './forced-relay-compatibility.ts'
export * from './forced-relay-target.ts'
export * from './forced-relay-eligibility.ts'
export * from './forced-relay-execution.ts'
