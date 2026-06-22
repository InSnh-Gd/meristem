import { describe, expect, it } from 'bun:test'
import {
  renderNetworkMap,
  renderNetworkMaps
} from '../../services/m-net/src/network-map-renderer.ts'
import { resolveNetworkMapSigningKeyMaterial } from '../../services/m-net/src/network-map-signing.ts'
import type {
  NetworkMapMemberInput,
  NetworkMapRenderInput,
  RequestedAclRule
} from '../../services/m-net/src/network-map-types.ts'

const perfSigningKey = resolveNetworkMapSigningKeyMaterial({}, { allowTestDefaults: true })

/**
 * 构造性能测试用的网络成员。
 */
function makeMember(nodeId: string): NetworkMapMemberInput {
  const kind = nodeId === 'stem-0' ? 'stem' : 'leaf'
  return { nodeId, nodeKind: kind, tunnelIp: '10.0.0.1', publicKey: `pubkey-${nodeId}` }
}

/**
 * 构造 stem→leaf 单向 ACL 规则集，保证规则数与成员数线性相关，
 * 避免全连通 mesh 引入 O(N²) 规则数干扰性能基线测量。
 */
function makeAclRules(members: readonly NetworkMapMemberInput[]): RequestedAclRule[] {
  return members
    .filter(m => m.nodeId !== 'stem-0')
    .map(m => ({
      action: 'allow' as const,
      sourceNodeId: 'stem-0',
      targetNodeId: m.nodeId,
      protocol: 'any' as const
    }))
}

/**
 * 构造指定成员数的 NetworkMapRenderInput。
 * @param memberCount 总成员数（含 stem）
 */
function buildRenderInput(memberCount: number): NetworkMapRenderInput {
  const members: NetworkMapMemberInput[] = []
  members.push(makeMember('stem-0'))
  for (let i = 1; i < memberCount; i++) {
    members.push(makeMember(`leaf-${i}`))
  }
  return {
    profileVersion: 'm-net-default@0.1.0',
    networkId: 'perf-network',
    members,
    requestedAclRules: makeAclRules(members),
    issuedAt: Date.now(),
    previousMapVersion: 0,
    signingKeyId: 'perf-signer',
    signingPrivateKeyPem: perfSigningKey.privateKeyPem
  }
}

describe('M-Net network map rendering performance', () => {
  it('小型网络（1 stem + 10 leaves）渲染应在 10ms 内完成', () => {
    const input = buildRenderInput(11)
    const start = performance.now()
    const map = renderNetworkMap(input)
    const elapsed = performance.now() - start
    expect(map.members).toHaveLength(11)
    expect(elapsed).toBeLessThan(10)
  })

  it('中型网络（1 stem + 50 leaves）渲染应在 50ms 内完成', () => {
    const input = buildRenderInput(51)
    const start = performance.now()
    const map = renderNetworkMap(input)
    const elapsed = performance.now() - start
    expect(map.members).toHaveLength(51)
    expect(elapsed).toBeLessThan(50)
  })

  it('渲染 50 节点不应呈现 O(N²) 行为——相对 11 节点不超过 10 倍', () => {
    const smallInput = buildRenderInput(11)
    const largeInput = buildRenderInput(51)

    const t0 = performance.now()
    renderNetworkMap(smallInput)
    const smallTime = performance.now() - t0

    const t1 = performance.now()
    renderNetworkMap(largeInput)
    const largeTime = performance.now() - t1

    // 规则数与成员数均增长约 5 倍（10→50 规则，11→51 成员），
    // 若呈现 O(N²) 则耗时增速远超 10 倍。当 smallTime 接近计时器
    // 精度时跳过比例断言，避免测量噪声导致假阳性。
    if (smallTime > 0.1) {
      expect(largeTime / smallTime).toBeLessThan(10)
    }
  })

  it('renderNetworkMaps 为 11 节点渲染独立签名地图应在 100ms 内完成', () => {
    const input = buildRenderInput(11)
    const start = performance.now()
    const results = renderNetworkMaps(input)
    const elapsed = performance.now() - start
    expect(results).toHaveLength(11)
    expect(elapsed).toBeLessThan(100)
  })
})
