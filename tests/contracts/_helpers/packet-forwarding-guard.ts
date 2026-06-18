import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export type PacketForwardingFinding = {
  filePath: string
  rule: string
  detail: string
}

const forbiddenDerpImportPattern = /derp/i
const forbiddenWireGuardKeyPattern = /^wireguard([_-])?private([_-])?key$/i

/**
 * 递归收集目录下的 TypeScript 文件，保持架构守卫只扫描源码边界而不扫无关输出。
 */
export function collectTypeScriptFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath)
  const files: string[] = []

  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry)
    const stats = statSync(nextPath)
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(nextPath))
      continue
    }
    if (nextPath.endsWith('.ts')) {
      files.push(nextPath)
    }
  }

  return files.sort()
}

/**
 * 扫描 Core 与 M-Net 源码是否误引入数据面包转发实现细节，
 * 保证控制面边界不会滑回 UDP/TCP relay 或私钥持有职责。
 */
export function scanPacketForwardingBoundaries(rootPaths: string[]): PacketForwardingFinding[] {
  const findings: PacketForwardingFinding[] = []

  for (const rootPath of rootPaths) {
    for (const filePath of collectTypeScriptFiles(rootPath)) {
      const sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      )

      const netImportNames = new Set<string>()
      const directCreateServerNames = new Set<string>()

      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const moduleName = node.moduleSpecifier.text

          if (moduleName === 'dgram' || moduleName === 'node:dgram') {
            findings.push({
              filePath,
              rule: 'forbidden-dgram-import',
              detail: `forbidden packet module import: ${moduleName}`
            })
          }

          if (forbiddenDerpImportPattern.test(moduleName)) {
            findings.push({
              filePath,
              rule: 'forbidden-derp-relay-import',
              detail: `forbidden DERP relay import: ${moduleName}`
            })
          }

          if (moduleName === 'net' || moduleName === 'node:net') {
            const clause = node.importClause
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) {
                const importedName = (element.propertyName ?? element.name).text
                const localName = element.name.text
                if (importedName === 'createServer') {
                  directCreateServerNames.add(localName)
                }
              }
            }

            if (clause?.name) {
              netImportNames.add(clause.name.text)
            }
            if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
              netImportNames.add(clause.namedBindings.name.text)
            }
          }
        }

        if (ts.isCallExpression(node)) {
          if (
            ts.isPropertyAccessExpression(node.expression) &&
            netImportNames.has(node.expression.expression.getText(sourceFile)) &&
            node.expression.name.text === 'createServer'
          ) {
            findings.push({
              filePath,
              rule: 'forbidden-raw-tcp-relay-server',
              detail: `forbidden raw TCP relay server call: ${node.expression.getText(sourceFile)}`
            })
          }

          if (
            ts.isIdentifier(node.expression) &&
            directCreateServerNames.has(node.expression.text)
          ) {
            findings.push({
              filePath,
              rule: 'forbidden-raw-tcp-relay-server',
              detail: `forbidden raw TCP relay server call: ${node.expression.text}(...)`
            })
          }
        }

        if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
          const propertyName = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, '')
          if (forbiddenWireGuardKeyPattern.test(propertyName)) {
            findings.push({
              filePath,
              rule: 'forbidden-wireguard-private-key-field',
              detail: `forbidden WireGuard private key field: ${propertyName}`
            })
          }
        }

        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          if (forbiddenWireGuardKeyPattern.test(node.name.text)) {
            findings.push({
              filePath,
              rule: 'forbidden-wireguard-private-key-field',
              detail: `forbidden WireGuard private key binding: ${node.name.text}`
            })
          }
        }

        if (ts.isIdentifier(node)) {
          if (
            /handleDerpRelay|createDerpRelayHandler|handleWstunnelRelay|createWstunnelRelayHandler/i.test(
              node.text
            )
          ) {
            findings.push({
              filePath,
              rule: 'forbidden-relay-handler',
              detail: `forbidden relay handler symbol: ${node.text}`
            })
          }
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }
  }

  return findings
}
