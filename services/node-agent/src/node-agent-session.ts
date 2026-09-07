/**
 * Node agent 会话组合入口：纯状态机（node-agent-session-state）与 runtime HTTP 客户端
 * （node-agent-runtime-client）在此统一 re-export，保持既有导入路径不变。
 */

// ---- runtime HTTP 客户端：URL 推导、schema 解码与 fetch 编排 ----
export {
  leaveNetwork,
  deriveControlUrl,
  fetchLatestNodeRuntimeNetworkMap,
  type RuntimeKeyRegistrationInput,
  type RuntimeKeyRegistrationResult,
  type RuntimeNetworkMapResult,
  registerNodeRuntimeKey
} from './node-agent-runtime-client.ts'
// ---- 纯会话状态机：状态类型、事件、迁移、退避与心跳调度 ----
export {
  type ConnectedSessionState,
  calculateBackoff,
  createHeartbeatSchedule,
  createInitialSessionState,
  type DisconnectedSessionState,
  type HeartbeatSchedule,
  type IdleSessionState,
  type JoinedSessionState,
  type JoiningSessionState,
  type JoinRedeemResult,
  type JoinRedeemSuccess,
  type JoinRejectedResult,
  type ReconnectingSessionState,
  redeemJoinTicket,
  resumeSession,
  type SessionAckMessage,
  type SessionFailedResult,
  type SessionResumeResult,
  type SessionResumeSuccess,
  type SessionState,
  type SessionStateEvent,
  transitionSessionState
} from './node-agent-session-state.ts'
