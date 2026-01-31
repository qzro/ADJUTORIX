
# ADJUTORIX Python Project Makefile
# Standardized workflow: fix → check → verify → deploy

PYTHON := python3
VENV := .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python

SRC := .
TESTS := tests

# --------------------------
# Environment
# --------------------------

.PHONY: venv
venv:
	@if [ ! -d "$(VENV)" ]; then \
		$(PYTHON) -m venv $(VENV); \
	fi
	$(PIP) install --upgrade pip

.PHONY: install
install: venv
	$(PIP) install -r requirements.txt

# --------------------------
# Formatting
# --------------------------

.PHONY: format
format:
	$(PY) -m ruff format $(SRC)

# --------------------------
# Linting
# --------------------------

.PHONY: lint
lint:
	$(PY) -m ruff check $(SRC)

.PHONY: lint-fix
lint-fix:
	$(PY) -m ruff check --fix $(SRC)

# --------------------------
# Type Checking
# --------------------------

.PHONY: typecheck
typecheck:
	$(PY) -m mypy $(SRC)

# --------------------------
# Testing
# --------------------------

.PHONY: test
test:
	$(PY) -m pytest $(TESTS)

# --------------------------
# Security
# --------------------------

.PHONY: security
security:
	$(PY) -m pip_audit

# --------------------------
# Dependency Audit
# --------------------------

.PHONY: deps
deps:
	$(PIP) list --outdated

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
# Build / Package
# --------------------------

.PHONY: build
build:
	$(PY) -m build

# --------------------------
# Cleanup
# --------------------------

.PHONY: clean
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache dist build *.egg-info

# --------------------------
# Help
# --------------------------

.PHONY: help
help:
	@echo "Available targets:"
	@echo "  venv       - Create virtual environment"
	@echo "  install    - Install dependencies"
	@echo "  format     - Format code"
	@echo "  lint       - Run linter"
	@echo "  lint-fix   - Auto-fix lint issues"
	@echo "  typecheck  - Run mypy"
	@echo "  test       - Run tests"
	@echo "  security   - Dependency security scan"
	@echo "  fix        - Format + auto-fix"
	@echo "  check      - Lint + type + test + security"
	@echo "  verify     - Clean + fix + check"
	@echo "  build      - Build package"
	@echo "  clean      - Remove caches/build artifacts"
