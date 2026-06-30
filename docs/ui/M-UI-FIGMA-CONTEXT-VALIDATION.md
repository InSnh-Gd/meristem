# M-UI Figma Context Validation

> Historical reference only. This file records how Figma validation was expected to work before the frontend design reset. It is not an active visual contract.

## Current Status

- No canonical Figma file is required for the current M-UI frontend work.
- No Figma MCP validation gate is active.
- Figma may be introduced later for exploration or handoff, but only under an explicit new task.

## If Figma Is Reintroduced

Future Figma usage should validate only the design direction approved for that task. Read-only inspection is sufficient for validation; write operations require a separate, explicit design handoff scope and the Figma write workflow prerequisites.

## Preserved Boundary

Even when using Figma, do not imply that capability domain services, M-Extension, or plugins provide runtime frontend pages or components. M-UI owns frontend structure; services own facts and capabilities; the BFF adapts service facts for UI consumption.
