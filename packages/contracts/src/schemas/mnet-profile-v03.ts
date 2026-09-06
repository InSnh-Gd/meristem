/**
 * M-Net v0.3 profile 契约 schema 入口。
 * schema 按组拆分：profile 结构（mnet-profile-v03-profile）、
 * migration_required 与兼容性结果（mnet-profile-v03-migration）、
 * v0.3 事件 payload（mnet-profile-v03-events）以及 legacy 兼容解码（mnet-profile-v03-decode）。
 * 本文件保持单一 re-export 出口，既有导入方（index.ts、mnet-profile.ts、ui.ts 等）不受影响。
 */

export * from './mnet-profile-v03-decode.ts'
export * from './mnet-profile-v03-events.ts'
export * from './mnet-profile-v03-migration.ts'
export * from './mnet-profile-v03-profile.ts'
