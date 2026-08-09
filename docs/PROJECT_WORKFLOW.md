# RightsRadar project workflow

This document describes a lightweight delivery loop for this repository.

## Delivery flow

1. Create or refine an issue.
2. Create a short-lived branch.
3. Open a pull request early.
4. Get CI green and required review.
5. Squash merge to `main`.

## Branch naming

Recommended patterns:

- `feature/<ticket-or-short-desc>`
- `fix/<ticket-or-short-desc>`
- `chore/<ticket-or-short-desc>`

Examples:

- `feature/fab-14-evaluation-harness`
- `fix/fab-15-upload-error-state`
- `chore/ci-cache-tuning`

## Label taxonomy

Use labels on issues and pull requests:

- `type:*` (for example `type:feature`, `type:bug`, `type:chore`, `type:docs`)
- `area:*` (for example `area:web`, `area:api`, `area:ci`, `area:infra`, `area:docs`, `area:research`)
- `priority:*` (`priority:P0`, `priority:P1`, `priority:P2`)
- `demo-critical`
- `blocked`

## Suggested GitHub Project board

Suggested project name: **RightsRadar — Hackathon Delivery**

### Fields

- **Status**: `Backlog`, `Ready`, `In progress`, `In review`, `Blocked`, `Done`
- **Priority**: `P0`, `P1`, `P2`
- **Area**: `Web`, `API`, `CI/CD`, `Infra`, `Docs`, `Research`
- **Size**: `S`, `M`, `L`
- **Demo-critical**: `Yes`, `No`

### Views

- **Team board**: grouped by `Status`
- **Demo readiness**: filter `Demo-critical = Yes`, grouped by `Status`
- **Post-demo / debt**: filter `Priority = P2` or non-demo items

## Repository settings not changed by this PR

This pull request only adds files. It does **not** create or modify repository settings.
Maintainers still need to configure these manually in GitHub:

- Labels
- GitHub Project board
- `main` branch protection/ruleset
- Real CODEOWNERS users/teams (replace placeholders)
