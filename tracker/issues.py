"""Open (or update) today's GitHub Issue and close the previous days' issues.

    python -m tracker.issues

Needs GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name), which GitHub Actions
provides. The issue is titled with the run date and carries the label
"daily-report". Running it twice on one day updates the same issue.
"""
from __future__ import annotations

import os
import sys

import requests

from .config import DEFAULT_PATHS
from .report import issue_body, issue_title
from .rows import read_csv
from .status import read_status

API = "https://api.github.com"
LABEL = "daily-report"


def _check(response):
    if response.status_code >= 400:
        raise RuntimeError("GitHub API error %s: %s" % (response.status_code, response.text[:200]))
    return response


def post_daily_issue(repo, token, date, body, session=None):
    """Create or update the issue titled `date`, close older open report issues."""
    http = session or requests.Session()
    headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    base = "%s/repos/%s/issues" % (API, repo)

    listing = _check(http.get(base, headers=headers, timeout=30,
                              params={"labels": LABEL, "state": "all", "per_page": 100})).json()
    issues = [issue for issue in listing if "pull_request" not in issue]

    title = issue_title(date)
    today = next((issue for issue in issues if issue["title"] == title), None)
    if today:
        result = _check(http.patch("%s/%d" % (base, today["number"]), headers=headers, timeout=30,
                                   json={"body": body, "state": "open"})).json()
    else:
        result = _check(http.post(base, headers=headers, timeout=30,
                                  json={"title": title, "body": body, "labels": [LABEL]})).json()

    closed = []
    for issue in issues:
        if issue["state"] == "open" and issue["title"] < title and issue["number"] != result["number"]:
            _check(http.patch("%s/%d" % (base, issue["number"]), headers=headers, timeout=30,
                              json={"state": "closed"}))
            closed.append(issue["number"])
    return result["number"], closed


def main(paths=DEFAULT_PATHS):
    token = os.environ.get("GITHUB_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not token or not repo:
        print("GITHUB_TOKEN and GITHUB_REPOSITORY must be set", file=sys.stderr)
        return 1
    status = read_status(paths)
    date = status["run_time"][:10]
    body = issue_body(read_csv(paths.history), status, date)
    number, closed = post_daily_issue(repo, token, date, body)
    print("issue #%d for %s; closed %s" % (number, date, closed or "none"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
