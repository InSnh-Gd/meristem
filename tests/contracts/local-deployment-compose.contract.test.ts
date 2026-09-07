import { expect, test } from 'bun:test'
import { coreServiceCommands } from '../../scripts/local-stack-runtime.ts'

const composePath = `${import.meta.dir}/../../docker-compose.yml`
const composeText = await Bun.file(composePath).text()
const apisixConfigPath = `${import.meta.dir}/../../ops/apisix/apisix.yaml`
const apisixConfigText = await Bun.file(apisixConfigPath).text()

test('local OpenSearch profile uses an available pinned OpenSearch 2 image', () => {
  expect(composeText).toContain('image: opensearchproject/opensearch:2.19.6')
  expect(composeText).not.toContain('opensearchproject/opensearch:2-alpine')
})

test('APISIX profile probes its gateway listener without requiring the Core upstream', () => {
  expect(composeText).toContain('network_mode: host')
  expect(composeText).toContain("bash -c 'exec 3<>/dev/tcp/127.0.0.1/9080'")
  expect(composeText).not.toContain('curl -fsS http://127.0.0.1:9080/api/v0/health')
  expect(apisixConfigText).toContain('"127.0.0.1:3000": 1')
  expect(apisixConfigText).not.toContain('host.docker.internal')
})

test('local service group includes a readiness-gated M-Deploy control plane', () => {
  const mDeploy = coreServiceCommands.find(service => service.label === 'dev:m-deploy')
  expect(mDeploy).toEqual({
    label: 'dev:m-deploy',
    command: ['bun', 'run', 'services/m-deploy/src/serve-local.ts'],
    readiness: 'http://127.0.0.1:3107/ready'
  })
})
