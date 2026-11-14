from tracker.issues import post_daily_issue


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status_code, self.text = payload, status, str(payload)

    def json(self):
        return self.payload


class FakeGitHub:
    """Remembers issues in memory and answers the three calls the code makes."""

    def __init__(self, issues):
        self.issues = {i["number"]: dict(i) for i in issues}
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(("GET", url))
        return FakeResponse(list(self.issues.values()))

    def post(self, url, json=None, **kwargs):
        self.calls.append(("POST", url))
        number = max(self.issues, default=0) + 1
        self.issues[number] = {"number": number, "state": "open", **json}
        return FakeResponse(self.issues[number], 201)

    def patch(self, url, json=None, **kwargs):
        self.calls.append(("PATCH", url))
        number = int(url.rsplit("/", 1)[1])
        self.issues[number].update(json)
        return FakeResponse(self.issues[number])


def issue(number, title, state="open"):
    return {"number": number, "title": title, "state": state, "body": "old"}


def test_creates_the_issue_with_the_date_as_title_and_the_label():
    github = FakeGitHub([])
    number, closed = post_daily_issue("o/r", "t", "2026-11-15", "body", session=github)
    created = github.issues[number]
    assert created["title"] == "2026-11-15" and created["body"] == "body"
    assert created["labels"] == ["daily-report"]
    assert closed == []


def test_closes_the_previous_days_issue():
    github = FakeGitHub([issue(1, "2026-11-14")])
    number, closed = post_daily_issue("o/r", "t", "2026-11-15", "body", session=github)
    assert closed == [1]
    assert github.issues[1]["state"] == "closed"
    assert github.issues[number]["state"] == "open"


def test_a_second_run_updates_the_same_issue_instead_of_adding_one():
    github = FakeGitHub([issue(1, "2026-11-14", "closed"), issue(2, "2026-11-15")])
    number, closed = post_daily_issue("o/r", "t", "2026-11-15", "new body", session=github)
    assert number == 2 and closed == []
    assert github.issues[2]["body"] == "new body"
    assert len(github.issues) == 2
    assert not [call for call in github.calls if call[0] == "POST"]


def test_a_second_run_reopens_todays_issue_and_leaves_closed_ones_alone():
    github = FakeGitHub([issue(1, "2026-11-15", "closed"), issue(2, "2026-11-13", "closed")])
    post_daily_issue("o/r", "t", "2026-11-15", "b", session=github)
    assert github.issues[1]["state"] == "open"
    assert github.issues[2]["state"] == "closed"


def test_pull_requests_are_ignored():
    github = FakeGitHub([{**issue(1, "2026-11-14"), "pull_request": {}}])
    _, closed = post_daily_issue("o/r", "t", "2026-11-15", "b", session=github)
    assert closed == [] and github.issues[1]["state"] == "open"
