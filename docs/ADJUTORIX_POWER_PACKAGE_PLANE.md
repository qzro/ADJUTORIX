# Adjutorix Power Package Plane

Adjutorix now carries the VERIFRAX, KAAFFILM, INVOCORDER and ANTIMATTERIUM packages as runtime dependencies inside the installable app surface.

This is a package power plane, not a false claim that every package behavior is automatically bound into every governed action.

## Runtime surfaces

- `configs/runtime/adjutorix_power_packages.json`
- `configs/runtime/adjutorix_power_adapters.json`
- `scripts/power/verify-adjutorix-power-packages.sh`
- `scripts/power/update-adjutorix-power-packages.sh`
- `scripts/power/verify-adjutorix-power-plane.sh`

## Commands

```bash
pnpm power:verify
pnpm power:plane
pnpm power:all
pnpm power:update
````

## App surface

The renderer exposes a `Power` feature button. It reads the installed runtime package plane through the preload bridge and reports package count, version, package.json surface, exports, bins and adapter grouping.

## Boundary

The packages are installed, packaged, visible, verifiable and updatable. Mutation still remains under Adjutorix verify/apply gates.
