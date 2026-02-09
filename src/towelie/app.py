import asyncio
from dataclasses import dataclass, asdict
from enum import Enum
import os
import subprocess
from pathlib import Path
import sys

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

dev_mode = os.environ.get("TOWELIE_DEV") == "1"


def _log_cmd(cmd):
    if not dev_mode:
        return
    if isinstance(cmd, (list, tuple)):
        print(f"  $ {' '.join(str(c) for c in cmd)}", file=sys.stderr)
    else:
        print(f"  $ {cmd}", file=sys.stderr)


class CheckStatus(Enum):
    PASS = "pass"
    FAIL = "fail"
    NO_CHECKS = "no_checks"


@dataclass
class CheckCommand:
    command: str
    shell: bool = True


@dataclass
class CommitInfo:
    hash: str
    label: str


ALL_CHANGES = "__all__"
UNCOMMITTED = "__uncommitted__"


@dataclass
class DiffResult:
    diff: str
    files: list[str]


@dataclass
class DiffResponse:
    branch: str
    base_branch: str
    commits: list[CommitInfo]
    selected_commit: str
    is_current_branch: bool
    diff: str
    files: list[str]


app = FastAPI()
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
app.mount(
    "/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static"
)


def get_git_root() -> Path:
    _log_cmd(["git", "rev-parse", "--show-toplevel"])
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
        _log_cmd(["git", "rev-parse", "--verify", branch])
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
        _log_cmd(["git", "branch", "--show-current"])
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=self.git_root,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    async def get_uncommitted_diff(self) -> DiffResult:
        _log_cmd(["git", "diff", "HEAD", "--unified=10"])
        diff_proc = await asyncio.create_subprocess_exec(
            "git", "diff", "HEAD", "--unified=10",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _log_cmd(["git", "diff", "--cached", "--name-only"])
        staged_files = await asyncio.create_subprocess_exec(
            "git", "diff", "--cached", "--name-only",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _log_cmd(["git", "diff", "--name-only"])
        unstaged_files = await asyncio.create_subprocess_exec(
            "git", "diff", "--name-only",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        diff_out, _ = await diff_proc.communicate()
        staged_files_out, _ = await staged_files.communicate()
        unstaged_files_out, _ = await unstaged_files.communicate()
        files = set()
        for f in staged_files_out.decode().strip().split("\n"):
            if f:
                files.add(f)
        for f in unstaged_files_out.decode().strip().split("\n"):
            if f:
                files.add(f)
        return DiffResult(diff=diff_out.decode(), files=sorted(files))

    async def get_commit_diff(self, commit: str) -> DiffResult:
        _log_cmd(["git", "diff", f"{commit}^", commit, "--unified=10"])
        diff_proc = await asyncio.create_subprocess_exec(
            "git",
            "diff",
            f"{commit}^",
            commit,
            "--unified=10",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _log_cmd(["git", "diff", f"{commit}^", commit, "--name-only"])
        files_proc = await asyncio.create_subprocess_exec(
            "git",
            "diff",
            f"{commit}^",
            commit,
            "--name-only",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        diff_stdout, _ = await diff_proc.communicate()
        files_stdout, _ = await files_proc.communicate()
        files = [f for f in files_stdout.decode().strip().split("\n") if f]
        return DiffResult(diff=diff_stdout.decode(), files=files)

    async def get_branch_diff(self, branch: str, base: str) -> DiffResult:
        _log_cmd(["git", "merge-base", base, branch])
        proc = await asyncio.create_subprocess_exec(
            "git",
            "merge-base",
            base,
            branch,
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        merge_base_ref = stdout.decode().strip()

        cmd = ["git", "diff", merge_base_ref, "--unified=10"]
        if branch != self.get_current_branch():
            cmd.insert(3, branch)

        _log_cmd(cmd)
        diff_proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        diff_stdout, _ = await diff_proc.communicate()

        is_current = branch == self.get_current_branch()
        _log_cmd(["git", "diff", f"{base}...{branch}", "--name-only"])
        files_proc = await asyncio.create_subprocess_exec(
            "git",
            "diff",
            f"{base}...{branch}",
            "--name-only",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        files_stdout, _ = await files_proc.communicate()
        files = set()
        for f in files_stdout.decode().strip().split("\n"):
            if f:
                files.add(f)
        if is_current:
            _log_cmd(["git", "diff", "HEAD", "--name-only"])
            head_proc = await asyncio.create_subprocess_exec(
                "git",
                "diff",
                "HEAD",
                "--name-only",
                cwd=self.git_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            head_stdout, _ = await head_proc.communicate()
            for f in head_stdout.decode().strip().split("\n"):
                if f:
                    files.add(f)
        return DiffResult(diff=diff_stdout.decode(), files=sorted(files))

    async def get_branches(self) -> list[str]:
        _log_cmd(["git", "branch", "--format=%(refname:short)"])
        proc = await asyncio.create_subprocess_exec(
            "git",
            "branch",
            "--format=%(refname:short)",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        current = self.get_current_branch()
        return [b for b in stdout.decode().strip().split("\n") if b and b != current]

    async def get_commits(
        self,
        branch: str,
        base: str,
    ) -> list[CommitInfo]:
        is_current = branch == self.get_current_branch()
        if is_current:
            all_label = "All changes (committed + uncommitted)"
        else:
            all_label = "All commits (branch diff)"
        commits: list[CommitInfo] = [CommitInfo(hash="", label=all_label)]
        if is_current:
            commits.append(CommitInfo(hash=UNCOMMITTED, label="Uncommitted changes only"))
        _log_cmd(["git", "log", f"{base}..{branch}", "--pretty=format:%H%x00%s"])
        proc = await asyncio.create_subprocess_exec(
            "git",
            "log",
            f"{base}..{branch}",
            "--pretty=format:%H%x00%s",
            cwd=self.git_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        for line in stdout.decode().split("\n"):
            if not line:
                continue
            full_hash, subject = line.split("\x00", 1)
            short_hash = full_hash[:7]
            commits.append(CommitInfo(hash=full_hash, label=f"{short_hash} {subject}"))
        return commits

    async def run_checks(self) -> "CheckResult":
        if not self.check_command:
            msg = (
                "No .pre-commit-config.yaml found in repository.\n"
                "Set up pre-commit hooks to enable checks.\n"
                "See: https://github.com/j178/prek/"
            )
            return CheckResult(status=CheckStatus.NO_CHECKS, output=msg)
        _log_cmd(self.check_command.command)
        if self.check_command.shell:
            proc = await asyncio.create_subprocess_shell(
                self.check_command.command,
                cwd=self.git_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                *self.check_command.command,
                cwd=self.git_root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        stdout, stderr = await proc.communicate()
        output = stdout.decode()
        error = stderr.decode()
        if proc.returncode == 0:
            return CheckResult(status=CheckStatus.PASS, output=output)
        return CheckResult(
            status=CheckStatus.FAIL, output=output, error=error
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
        },
    )


@app.get("/api/diff")
async def diff(
    branch: str | None = None,
    base: str | None = None,
    commit: str | None = None,
):
    effective_branch = branch or PROJECT.get_current_branch()
    effective_base = base or PROJECT.base_branch
    is_current_branch = effective_branch == PROJECT.get_current_branch()

    if commit == UNCOMMITTED and not is_current_branch:
        result = DiffResult(diff="", files=[])
    elif commit == UNCOMMITTED:
        result = await PROJECT.get_uncommitted_diff()
    elif commit:
        result = await PROJECT.get_commit_diff(commit)
    else:
        result = await PROJECT.get_branch_diff(effective_branch, effective_base)

    commits = await PROJECT.get_commits(branch=effective_branch, base=effective_base)

    response = DiffResponse(
        branch=effective_branch,
        base_branch=effective_base,
        commits=commits,
        selected_commit=commit or "",
        is_current_branch=is_current_branch,
        diff=result.diff,
        files=result.files,
    )
    return asdict(response)


@app.get("/api/branches")
async def branches():
    branches_list = await PROJECT.get_branches()
    return {"branches": branches_list, "current": PROJECT.get_current_branch()}


@app.get("/api/checks")
async def checks():
    results = await PROJECT.run_checks()
    d = asdict(results)
    d["status"] = results.status.value
    return d
