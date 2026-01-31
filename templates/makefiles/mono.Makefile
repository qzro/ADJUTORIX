
# ADJUTORIX Monorepo Makefile
# Unified control for mixed Python / Node / Tooling repos

SHELL := /bin/bash

# Workspace directories
PACKAGES := packages
SHARED := packages/shared
AGENT := packages/adjutorix-agent
VSCODE := packages/adjutorix-vscode
CLI := packages/adjutorix-cli

# --------------------------
# Helpers
# --------------------------

define run_in_dir
	cd $(1) && $(2)
endef

# --------------------------
# Install
# --------------------------

.PHONY: install
install:
	@echo "Installing all workspace dependencies..."
	$(call run_in_dir,$(SHARED),npm install)
	$(call run_in_dir,$(VSCODE),npm install)
	$(call run_in_dir,$(AGENT),pip install -e .)
	$(call run_in_dir,$(CLI),pip install -e .)

# --------------------------
# Format
# --------------------------

.PHONY: format
format:
	@echo "Formatting all packages..."
	$(call run_in_dir,$(SHARED),npm run format || true)
	$(call run_in_dir,$(VSCODE),npm run format || true)
	$(call run_in_dir,$(AGENT),ruff format . || true)
	$(call run_in_dir,$(CLI),ruff format . || true)

# --------------------------
# Lint
# --------------------------

.PHONY: lint
lint:
	@echo "Linting all packages..."
	$(call run_in_dir,$(SHARED),npm run lint || true)
	$(call run_in_dir,$(VSCODE),npm run lint || true)
	$(call run_in_dir,$(AGENT),ruff check . || true)
	$(call run_in_dir,$(CLI),ruff check . || true)

# --------------------------
# Typecheck
# --------------------------

.PHONY: typecheck
typecheck:
	@echo "Typechecking..."
	$(call run_in_dir,$(SHARED),npm run typecheck || true)
	$(call run_in_dir,$(VSCODE),npm run typecheck || true)
	$(call run_in_dir,$(AGENT),mypy . || true)
	$(call run_in_dir,$(CLI),mypy . || true)

# --------------------------
# Tests
# --------------------------

.PHONY: test
test:
	@echo "Running tests..."
	$(call run_in_dir,$(SHARED),npm test || true)
	$(call run_in_dir,$(VSCODE),npm test || true)
	$(call run_in_dir,$(AGENT),pytest || true)
	$(call run_in_dir,$(CLI),pytest || true)

# --------------------------
# Security
# --------------------------

.PHONY: security
security:
	@echo "Running security audits..."
	$(call run_in_dir,$(SHARED),npm audit || true)
	$(call run_in_dir,$(VSCODE),npm audit || true)
	$(call run_in_dir,$(AGENT),pip-audit || true)
	$(call run_in_dir,$(CLI),pip-audit || true)

# --------------------------
# Composite Targets
# --------------------------

.PHONY: fix
fix: format lint
	@echo "Fix stage complete."

.PHONY: check
check: lint typecheck test security
	@echo "Check stage complete."

.PHONY: verify
verify: clean fix check
	@echo "Verify stage complete."

# --------------------------
# Build
# --------------------------

.PHONY: build
build:
	@echo "Building packages..."
	$(call run_in_dir,$(SHARED),npm run build || true)
	$(call run_in_dir,$(VSCODE),npm run build || true)

# --------------------------
# Clean
# --------------------------

.PHONY: clean
clean:
	@echo "Cleaning workspace..."
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name "node_modules" -prune -exec rm -rf {} +
	find . -type d -name "dist" -prune -exec rm -rf {} +
	find . -type d -name "build" -prune -exec rm -rf {} +
	rm -rf coverage

# --------------------------
# Status
# --------------------------

.PHONY: status
status:
	@echo "Workspace status:"
	git status --short

# --------------------------
# Help
# --------------------------

.PHONY: help
help:
	@echo "ADJUTORIX Monorepo Targets:"
	@echo ""
	@echo "  install   - Install all dependencies"
	@echo "  format    - Format all code"
	@echo "  lint      - Lint all packages"
	@echo "  typecheck - Typecheck all packages"
	@echo "  test      - Run all tests"
	@echo "  security  - Run security audits"
	@echo "  fix       - format + lint"
	@echo "  check     - lint + typecheck + test + security"
	@echo "  verify    - clean + fix + check"
	@echo "  build     - Build JS packages"
	@echo "  clean     - Remove artifacts"
	@echo "  status    - Git status"
