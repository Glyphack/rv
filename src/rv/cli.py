import argparse
import subprocess
import sys
import webbrowser
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = PROJECT_ROOT / "web"


def check_git_repository():
    """Check if current directory is inside a git repository."""
    result = subprocess.run(
        ["git", "rev-parse", "--git-dir"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("Error: rv only supports git repositories", file=sys.stderr)
        print("Please run rv from within a git repository", file=sys.stderr)
        sys.exit(1)


def dev():
    check_git_repository()
    import uvicorn

    static_dir = Path(__file__).resolve().parent / "static"

    print("Starting frontend & tailwind watchers...")
    esbuild = subprocess.Popen(["npm", "run", "watch"], cwd=PROJECT_ROOT)
    tailwind = subprocess.Popen(
        [
            "npx",
            "@tailwindcss/cli",
            "-i",
            str(static_dir / "input.css"),
            "-o",
            str(static_dir / "output.css"),
            "--watch",
        ],
        cwd=PROJECT_ROOT,
    )

    port = 4242
    print(f"\n  rv → http://localhost:{port}\n")
    webbrowser.open(f"http://localhost:{port}")
    try:
        uvicorn.run("rv.app:app", host="127.0.0.1", port=port, reload=True)
    finally:
        esbuild.terminate()
        tailwind.terminate()


def run():
    check_git_repository()
    import uvicorn

    port = 4242
    print(f"\n  rv → http://localhost:{port}\n")
    webbrowser.open(f"http://localhost:{port}")
    uvicorn.run("rv.app:app", host="127.0.0.1", port=port)


def main():
    parser = argparse.ArgumentParser(description="rv - Local code review for AI agents")
    parser.add_argument("--dev", action="store_true", help="Run in development mode with npm and tailwind watchers")
    args = parser.parse_args()

    if args.dev:
        dev()
    else:
        run()


if __name__ == "__main__":
    main()
