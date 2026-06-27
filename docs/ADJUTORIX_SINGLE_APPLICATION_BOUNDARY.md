# ADJUTORIX Single Application Boundary

ADJUTORIX is operated as one human-facing installed application:

```text
/Applications/Adjutorix.app
````

The repository contains source, contracts, policies, tests, and build scripts.

The repository must not treat generated build products, packaged application bundles, DMGs, dependency folders, Python bytecode caches, or runtime output as source truth.

Canonical human surface:

```text
Adjutorix.app
```

Canonical install script:

```text
scripts/app/install-one-adjutorix-app.sh
```

Generated surfaces are disposable:

```text
node_modules/
packages/*/node_modules/
packages/*/dist/
packages/adjutorix-app/dist/
packages/adjutorix-app/release/
__pycache__/
*.pyc
*.dmg
*.blockmap
```

The app may contain a large machine internally.

The user must experience one application.
