# M-UI Design-System CLI Evaluation

> Historical reference only. This file records an earlier evaluation of design-system tooling. It is not an active design authority and must not override current product or user requirements.

## Summary

The earlier evaluation considered whether an automated design-system CLI should maintain a canonical M-UI visual contract. That approach has been retired for the current frontend reboot: the active UI boundary is the SDUI route/component contract plus the M-UI BFF service contract.

## Current Status

- No canonical visual design-system source is maintained in the repository.
- No design-system lint command is part of the standard gate matrix.
- Stitch, Figma, and design-system extraction tooling may still be used later as optional exploration tools, but they must start from the current task's requirements rather than from this historical evaluation.

## Guidance for Future Work

If design tooling is reintroduced, treat it as a new decision with fresh acceptance criteria. Do not revive the previous CLI gate or visual-token authority by default.
