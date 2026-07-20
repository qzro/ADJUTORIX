# Adjutorix Guided Mission Composer

## Product purpose

The guided mission composer converts one plain-language request into a
governed Adjutorix mission.

The operator describes the intended outcome rather than selecting an internal
subsystem.

Adjutorix then:

1. infers the required workflow;
2. selects the correct governed product surface;
3. emits a structured mission baton;
4. persists the latest mission locally;
5. activates exactly one managed surface;
6. preserves every mounted authority surface.

## Workflow inference

The mission composer routes requests through five product outcomes:

- **Understand** — questions, diagnosis, exploration, and workspace comprehension;
- **Plan** — architecture, scope, sequencing, strategy, and implementation planning;
- **Build** — implementation, fixes, refactors, additions, removals, and upgrades;
- **Verify** — testing, auditing, validation, review, and proof;
- **Ship** — release, publication, deployment, distribution, archive, and finality.

## Mission baton

Every launch emits:

`adjutorix:guided-mission:launch`

The event carries an `adjutorix.guided_mission.v1` object containing:

- mission identifier;
- original task;
- inferred workflow;
- selected surface identifier;
- selected surface title;
- creation time;
- source identity;
- authority-preservation declaration.

The latest mission is persisted under:

`adjutorix.guided_mission.v1`

## Governed routing

The composer routes through the four primary tools proven by Move 214:

- `adjutorix-ai-assistant`;
- `adjutorix-ai-workspace-context-pack`;
- `adjutorix-ai-patch-runway`;
- `adjutorix-ai-patch-verify-runway`.

Shipping requests route into the current ten-surface publication chain while
the complete 95-surface authority chain remains mounted and hidden until
explicit selection.

## Interaction model

The operator may launch through the button or Command-Enter.

A launch closes the guided deck, activates exactly one target surface, and
leaves every other managed surface hidden.

This creates a single visible task path without reducing governance,
verification, replay, evidence, archive, publication, distribution, or
terminal authority.
