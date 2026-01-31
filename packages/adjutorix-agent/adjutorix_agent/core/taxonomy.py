from enum import Enum
from dataclasses import dataclass
from typing import Optional, Dict


class ErrorCategory(str, Enum):
    ENV = "ENV"
    STYLE = "STYLE"
    TYPE = "TYPE"
    TEST = "TEST"
    BUILD = "BUILD"
    DEPLOY = "DEPLOY"
    SECURITY = "SECURITY"
    RUNTIME = "RUNTIME"
    UNKNOWN = "UNKNOWN"


@dataclass
class ErrorSignature:
    category: ErrorCategory
    pattern: str
    description: str
    first_action: str


class ErrorTaxonomy:
    """
    Classifies failures into deterministic categories.
    Prevents random debugging loops.
    """

    def __init__(self) -> None:
        self._signatures: list[ErrorSignature] = []
        self._register_defaults()

    # -------------------------
    # Public API
    # -------------------------

    def classify(self, output: str) -> ErrorCategory:
        """
        Classify error output into a category.
        """

        normalized = output.lower()

        for sig in self._signatures:
            if sig.pattern in normalized:
                return sig.category

        return ErrorCategory.UNKNOWN

    def get_first_action(
        self, category: ErrorCategory
    ) -> Optional[str]:
        """
        Return deterministic first step for category.
        """

        for sig in self._signatures:
            if sig.category == category:
                return sig.first_action

        return None

    def explain(self, category: ErrorCategory) -> str:
        """
        Human-readable explanation.
        """

        explanations: Dict[ErrorCategory, str] = {
            ErrorCategory.ENV: "Environment or dependency problem",
            ErrorCategory.STYLE: "Formatting or lint violation",
            ErrorCategory.TYPE: "Type checking failure",
            ErrorCategory.TEST: "Unit/integration test failure",
            ErrorCategory.BUILD: "Compilation or build failure",
            ErrorCategory.DEPLOY: "Deployment configuration error",
            ErrorCategory.SECURITY: "Security or secret exposure",
            ErrorCategory.RUNTIME: "Runtime crash or exception",
            ErrorCategory.UNKNOWN: "Unclassified failure",
        }

        return explanations.get(
            category, "Unrecognized error category"
        )

    # -------------------------
    # Internals
    # -------------------------

    def _register_defaults(self) -> None:
        """
        Register built-in error signatures.
        """

        self._signatures.extend(
            [
                # ENV
                ErrorSignature(
                    ErrorCategory.ENV,
                    "no module named",
                    "Missing Python dependency",
                    "pip install -r requirements.txt",
                ),
                ErrorSignature(
                    ErrorCategory.ENV,
                    "command not found",
                    "Missing system binary",
                    "Install required tool",
                ),
                ErrorSignature(
                    ErrorCategory.ENV,
                    "module not found",
                    "Missing Node dependency",
                    "npm install",
                ),

                # STYLE
                ErrorSignature(
                    ErrorCategory.STYLE,
                    "flake8",
                    "Python lint failure",
                    "run formatter (ruff/black)",
                ),
                ErrorSignature(
                    ErrorCategory.STYLE,
                    "eslint",
                    "JS lint failure",
                    "npm run lint -- --fix",
                ),
                ErrorSignature(
                    ErrorCategory.STYLE,
                    "format",
                    "Formatting issue",
                    "run formatter",
                ),

                # TYPE
                ErrorSignature(
                    ErrorCategory.TYPE,
                    "mypy",
                    "Python type error",
                    "run mypy and fix types",
                ),
                ErrorSignature(
                    ErrorCategory.TYPE,
                    "tsc",
                    "TypeScript type error",
                    "run tsc --noEmit",
                ),
                ErrorSignature(
                    ErrorCategory.TYPE,
                    "type error",
                    "Generic type failure",
                    "fix type annotations",
                ),

                # TEST
                ErrorSignature(
                    ErrorCategory.TEST,
                    "assert",
                    "Assertion failure",
                    "inspect failing test",
                ),
                ErrorSignature(
                    ErrorCategory.TEST,
                    "failed",
                    "Test failure",
                    "run targeted tests",
                ),
                ErrorSignature(
                    ErrorCategory.TEST,
                    "pytest",
                    "Pytest failure",
                    "pytest -x",
                ),

                # BUILD
                ErrorSignature(
                    ErrorCategory.BUILD,
                    "compilation failed",
                    "Compiler error",
                    "fix build errors",
                ),
                ErrorSignature(
                    ErrorCategory.BUILD,
                    "make:",
                    "Makefile failure",
                    "inspect build logs",
                ),
                ErrorSignature(
                    ErrorCategory.BUILD,
                    "webpack",
                    "Webpack failure",
                    "fix bundler config",
                ),

                # DEPLOY
                ErrorSignature(
                    ErrorCategory.DEPLOY,
                    "wrangler",
                    "Cloudflare deploy failure",
                    "check wrangler config",
                ),
                ErrorSignature(
                    ErrorCategory.DEPLOY,
                    "permission denied",
                    "Deploy permission error",
                    "check credentials",
                ),

                # SECURITY
                ErrorSignature(
                    ErrorCategory.SECURITY,
                    "secret",
                    "Secret detected",
                    "rotate credentials",
                ),
                ErrorSignature(
                    ErrorCategory.SECURITY,
                    "token",
                    "Token leak",
                    "revoke token",
                ),
                ErrorSignature(
                    ErrorCategory.SECURITY,
                    "vulnerability",
                    "Dependency vulnerability",
                    "run audit + upgrade",
                ),

                # RUNTIME
                ErrorSignature(
                    ErrorCategory.RUNTIME,
                    "traceback",
                    "Python runtime exception",
                    "inspect stacktrace",
                ),
                ErrorSignature(
                    ErrorCategory.RUNTIME,
                    "segmentation fault",
                    "Native crash",
                    "debug core dump",
                ),
                ErrorSignature(
                    ErrorCategory.RUNTIME,
                    "panic",
                    "Runtime panic",
                    "inspect logs",
                ),
            ]
        )
