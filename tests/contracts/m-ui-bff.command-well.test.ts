import { registerCommandWellCoreDispatchContractTests } from './m-ui-bff.command-well.core-dispatch.test.ts'
import { registerCommandWellExecuteInputAuthContractTests } from './m-ui-bff.command-well.execute-input-auth.test.ts'
import { registerCommandWellNetworkProfileExecuteContractTests } from './m-ui-bff.command-well.network-profile-execute.test.ts'
import { registerCommandWellNoopContractTests } from './m-ui-bff.command-well.noop.test.ts'
import { registerCommandWellPreviewEligibilityContractTests } from './m-ui-bff.command-well.preview-eligibility.test.ts'
import { registerCommandWellPreviewExecuteContractTests } from './m-ui-bff.command-well.preview-execute.test.ts'
import { registerCommandWellSideEffectsContractTests } from './m-ui-bff.command-well.side-effects.test.ts'
import { installMUiBffFetchLifecycle } from './_helpers/m-ui-bff-fetch-lifecycle.ts'

installMUiBffFetchLifecycle()
registerCommandWellNoopContractTests()
registerCommandWellPreviewEligibilityContractTests()
registerCommandWellPreviewExecuteContractTests()
registerCommandWellExecuteInputAuthContractTests()
registerCommandWellCoreDispatchContractTests()
registerCommandWellNetworkProfileExecuteContractTests()
registerCommandWellSideEffectsContractTests()
