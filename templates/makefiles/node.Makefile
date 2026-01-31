
# ADJUTORIX Node.js / TypeScript Project Makefile
# Standardized workflow: fix → check → verify → deploy

NODE := node
NPM := npm
NPX := npx

SRC := src
TESTS := test

# --------------------------
# Environment
# --------------------------

.PHONY: install
install:
	$(NPM) install

# --------------------------
# Formatting
# --------------------------

.PHONY: format
format:
	$(NPX) prettier --write .

# --------------------------
# Linting
# --------------------------

.PHONY: lint
lint:
	$(NPX) eslint .

.PHONY: lint-fix
lint-fix:
	$(NPX) eslint . --fix

# --------------------------
# Type Checking
# --------------------------

.PHONY: typecheck
typecheck:
	$(NPX) tsc --noEmit

# --------------------------
# Testing
# --------------------------

.PHONY: test
test:
	$(NPM) test

# --------------------------
# Security
# --------------------------

.PHONY: security
security:
	$(NPM) audit --audit-level=moderate

# --------------------------
# Dependency Audit
# --------------------------

.PHONY: deps
deps:
	$(NPM) outdated

# --------------------------
# Composite Targets
# --------------------------

.PHONY: fix
fix: format lint-fix

.PHONY: check
check: lint typecheck test security

.PHONY: verify
verify: clean fix check

# --------------------------
# Build
# --------------------------

.PHONY: build
build:
	$(NPM) run build

# --------------------------
# Cleanup
# --------------------------

.PHONY: clean
clean:
	rm -rf node_modules dist build coverage

# --------------------------
# Help
# --------------------------

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  install    - Install dependencies"
	@echo "  format     - Format code (Prettier)"
	@echo "  lint       - Run ESLint"
	@echo "  lint-fix   - Auto-fix lint issues"
	@echo "  typecheck  - Run TypeScript checker"
	@echo "  test       - Run tests"
	@echo "  security   - npm audit"
	@echo "  fix        - Format + auto-fix"
	@echo "  check      - Lint + type + test + security"
	@echo "  verify     - Clean + fix + check"
	@echo "  build      - Build project"
	@echo "  clean      - Remove artifacts"
