import { registerRoutesCommandWellContractTests } from './m-ui-bff.routes.command-well.test.ts'
import { registerRoutesNetworkProfilesContractTests } from './m-ui-bff.routes.network-profiles.test.ts'
import { registerRoutesPolicyContractTests } from './m-ui-bff.routes.policy.test.ts'
import { registerRoutesRegistryDataContractTests } from './m-ui-bff.routes.registry-data.test.ts'
import { registerRoutesServicesContractTests } from './m-ui-bff.routes.services.test.ts'
import { installMUiBffFetchLifecycle } from './_helpers/m-ui-bff-fetch-lifecycle.ts'

installMUiBffFetchLifecycle()
registerRoutesRegistryDataContractTests()
registerRoutesPolicyContractTests()
registerRoutesNetworkProfilesContractTests()
registerRoutesServicesContractTests()
registerRoutesCommandWellContractTests()
