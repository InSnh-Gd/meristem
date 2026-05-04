import { createCoreApp } from './app.ts'
import { createProductionDeps } from './adapters.ts'

const deps = await createProductionDeps()
const port = Number(process.env.PORT ?? '3000')

createCoreApp(deps).listen(port)
console.log(`meristem-core listening on http://localhost:${port}`)

process.on('SIGINT', () => {
  void deps.close().then(() => process.exit(0))
})

