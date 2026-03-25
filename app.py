import os
import re
import subprocess
import time
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Simple cache for file lists: { repo_path: (timestamp, [files]) }
_file_cache = {}
_CACHE_TTL = 60  # seconds


def _run_git(repo_path, args):
    """Run a git command in the given repo and return the result."""
    result = subprocess.run(
        ["git", "-C", repo_path] + args,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result


def _is_git_repo(path):
    """Check if a path is a valid git repository."""
    path = os.path.expanduser(path)
    path = os.path.realpath(path)
    if not os.path.isdir(path):
        return False, path
    result = _run_git(path, ["rev-parse", "--git-dir"])
    return result.returncode == 0, path


def _parse_github_url(remote_url):
    """Parse a git remote URL into a GitHub base URL."""
    remote_url = remote_url.strip()
    # SSH format: git@github.com:user/repo.git
    match = re.match(r"git@github\.com:(.+?)(?:\.git)?$", remote_url)
    if match:
        return f"https://github.com/{match.group(1)}"
    # HTTPS format: https://github.com/user/repo.git
    match = re.match(r"https?://github\.com/(.+?)(?:\.git)?$", remote_url)
    if match:
        return f"https://github.com/{match.group(1)}"
    return None



@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/validate-repo", methods=["POST"])
def validate_repo():
    data = request.get_json()
    path = data.get("path", "")
    if not path:
        return jsonify({"valid": False, "error": "No path provided"})

    valid, resolved = _is_git_repo(path)
    if valid:
        name = os.path.basename(resolved)
        return jsonify({"valid": True, "name": name, "path": resolved})
    return jsonify({"valid": False, "error": "Not a git repository"})


@app.route("/api/files", methods=["POST"])
def list_files():
    data = request.get_json()
    path = data.get("path", "")
    query = data.get("query", "").lower()

    valid, resolved = _is_git_repo(path)
    if not valid:
        return jsonify({"files": [], "error": "Invalid repository"})

    # Check cache
    now = time.time()
    cached = _file_cache.get(resolved)
    if cached and (now - cached[0]) < _CACHE_TTL:
        all_files = cached[1]
    else:
        result = _run_git(resolved, ["ls-files"])
        if result.returncode != 0:
            return jsonify({"files": [], "error": "Failed to list files"})
        all_files = [f for f in result.stdout.strip().split("\n") if f]
        _file_cache[resolved] = (now, all_files)

    if not query:
        return jsonify({"files": all_files[:50]})

    # Filter with case-insensitive match, prioritizing filename matches
    matches = []
    for f in all_files:
        if query in f.lower():
            matches.append(f)
            if len(matches) >= 50:
                break

    return jsonify({"files": matches})


@app.route("/api/search", methods=["POST"])
def search_commits():
    data = request.get_json()
    path = data.get("path", "")
    files = data.get("files", [])
    start_date = data.get("startDate", "")
    end_date = data.get("endDate", "")

    valid, resolved = _is_git_repo(path)
    if not valid:
        return jsonify({"commits": [], "error": "Invalid repository"})

    if not files:
        return jsonify({"commits": [], "error": "No files specified"})

    args = [
        "log",
        f"--after={start_date}",
        f"--before={end_date}",
        "--format=%H|%an|%aI|%s",
        "-n", "200",
        "--",
    ] + files

    result = _run_git(resolved, args)
    if result.returncode != 0:
        return jsonify({"commits": [], "error": "Git log failed"})

    commits = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({
                "hash": parts[0],
                "author": parts[1],
                "date": parts[2],
                "message": parts[3],
            })

    truncated = len(commits) >= 200
    return jsonify({"commits": commits, "truncated": truncated})


@app.route("/api/diff", methods=["POST"])
def get_diff():
    data = request.get_json()
    path = data.get("path", "")
    commit_hash = data.get("hash", "")
    files = data.get("files", [])

    valid, resolved = _is_git_repo(path)
    if not valid:
        return jsonify({"diff": "", "error": "Invalid repository"})

    if not commit_hash:
        return jsonify({"diff": "", "error": "No commit hash provided"})

    # Try normal diff first
    args = ["diff", f"{commit_hash}^..{commit_hash}", "--"] + files
    result = _run_git(resolved, args)

    # If it fails (e.g. initial commit with no parent), try --root
    if result.returncode != 0:
        args = ["diff-tree", "--root", "-p", commit_hash, "--"] + files
        result = _run_git(resolved, args)

    if result.returncode != 0:
        return jsonify({"diff": "", "error": "Failed to get diff"})

    diff_text = result.stdout
    # Truncate large diffs
    max_size = 500 * 1024  # 500KB
    if len(diff_text) > max_size:
        diff_text = diff_text[:max_size]
        diff_text += "\n\n... diff truncated (exceeded 500KB) ..."

    return jsonify({"diff": diff_text})


@app.route("/api/remote-url", methods=["POST"])
def get_remote_url():
    data = request.get_json()
    path = data.get("path", "")

    valid, resolved = _is_git_repo(path)
    if not valid:
        return jsonify({"url": None, "error": "Invalid repository"})

    result = _run_git(resolved, ["remote", "get-url", "origin"])
    if result.returncode != 0:
        return jsonify({"url": None})

    github_url = _parse_github_url(result.stdout)
    return jsonify({"url": github_url})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
