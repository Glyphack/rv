import asyncio
from dataclasses import dataclass, asdict
from enum import Enum
import subprocess
from pathlib import Path
import sys

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


class CheckStatus(Enum):
    PASS = "pass"
    FAIL = "fail"
    NO_CHECKS = "no_checks"


@dataclass
class CheckCommand:
    command: str
    shell: bool = True


app = FastAPI()
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
app.mount(
    "/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static"
)


def get_git_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("Error: not a git repository", file=sys.stderr)
        sys.exit(1)
    return Path(result.stdout.strip())


def get_base_branch():
    """Detect base branch by trying main and master and see which one exists."""
    for branch in ("main", "master"):
        result = subprocess.run(
            ["git", "rev-parse", "--verify", branch],
            capture_output=True,
        )
        if result.returncode == 0:
            return branch
    return "main"


@dataclass
class Project:
    git_root: Path = get_git_root()
    base_branch = get_base_branch()

    def _has_precommit_config(self) -> bool:
        return (self.git_root / ".pre-commit-config.yaml").exists()

    @property
    def check_command(self) -> CheckCommand | None:
        if self._has_precommit_config():
            return CheckCommand(command="prek -a")
        return None

    def get_current_branch(self) -> str:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=self.git_root,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    async def get_diff(self, branch: str) -> str:
        proc = await asyncio.create_subprocess_exec(
            "git", "merge-base", self.base_branch, branch,
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        merge_base_ref = stdout.decode().strip()

        cmd = ["git", "diff", merge_base_ref, "--unified=10"]
        if branch != self.get_current_branch():
            cmd.insert(3, branch)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode()

    async def get_branches(self) -> list[str]:
        proc = await asyncio.create_subprocess_exec(
            "git", "branch", "--format=%(refname:short)",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        current = self.get_current_branch()
        return [b for b in stdout.decode().strip().split("\n") if b and b != current]

    async def get_changed_files(self, branch: str) -> list[str]:
        base = self.base_branch
        is_current = branch == self.get_current_branch()
        proc = await asyncio.create_subprocess_exec(
            "git", "diff", f"{base}...{branch}", "--name-only",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        files = set()
        for f in stdout.decode().strip().split("\n"):
            if f:
                files.add(f)
        if is_current:
            proc = await asyncio.create_subprocess_exec(
                "git", "diff", "HEAD", "--name-only",
                cwd=self.git_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            for f in stdout.decode().strip().split("\n"):
                if f:
                    files.add(f)
        return sorted(files)

    def run_checks(self) -> "CheckResult":
        if not self.check_command:
            msg = (
                "No .pre-commit-config.yaml found in repository.\n"
                "Set up pre-commit hooks to enable checks.\n"
                "See: https://github.com/j178/prek/"
            )
            return CheckResult(status=CheckStatus.NO_CHECKS, output=msg)
        result = subprocess.run(
            self.check_command.command,
            shell=self.check_command.shell,
            cwd=self.git_root,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return CheckResult(status=CheckStatus.PASS, output=result.stdout)
        return CheckResult(
            status=CheckStatus.FAIL, output=result.stdout, error=result.stderr
        )

PROJECT: Project = Project()


@dataclass
class CheckResult:
    status: CheckStatus
    output: str = ""
    error: str = ""


def parse_check_output(raw: CheckResult) -> list[dict]:
    results: list[dict] = []
    output = raw.output
    for line in output.splitlines():
        name = line.strip()
        if not name:
            continue
        results.append({"name": name, "passed": raw.status == CheckStatus.PASS})
    return results


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "checks": PROJECT.run_checks(),
        },
    )


@app.get("/api/diff")
async def diff(branch: str | None = None):
    effective_branch = branch or PROJECT.get_current_branch()
    raw_diff = await PROJECT.get_diff(branch=effective_branch)
    files = await PROJECT.get_changed_files(branch=effective_branch)
    return {"diff": raw_diff, "files": files}


@app.get("/api/branches")
async def branches():
    branches_list = await PROJECT.get_branches()
    return {"branches": branches_list, "current": PROJECT.get_current_branch()}


@app.get("/api/checks")
async def checks():
    results = PROJECT.run_checks()
    d = asdict(results)
    d["status"] = results.status.value
    return d
