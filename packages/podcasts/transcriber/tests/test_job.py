import pytest

from epod_transcriber.cli import main
from epod_transcriber.job import parse_job
from epod_transcriber.util import JobError

BASE = {"version": 1, "slug": "s", "workDir": "/w", "audioDir": "/a", "outputPath": "/w/t.json", "hostName": "H"}


def test_minimal_job_gets_defaults():
    job = parse_job(BASE)
    assert job.model == "small.en" and job.num_speakers is None and job.diarizer == "diarize"
    assert job.youtube_url is None and job.feed is None and job.chunk_seconds == 600 and job.cpu_threads == 8


@pytest.mark.parametrize(
    "patch, message",
    [
        ({"version": 2}, "unsupported version"),
        ({"hostName": None}, "'hostName' is required"),
        ({"numSpeakers": 0}, "between 1 and 20"),
        ({"numSpeakers": True}, "wrong type"),
        ({"diarizer": "whisperx"}, "diarizer must be"),
        ({"limitSeconds": -1}, "positive"),
        ({"feed": {"title": "x"}}, "'url' is required"),
    ],
)
def test_invalid_jobs_are_rejected_with_a_precise_message(patch, message):
    with pytest.raises(JobError, match=message):
        parse_job({**BASE, **patch})


def test_cli_exit_codes(tmp_path, capsys):
    bad = tmp_path / "job.json"
    bad.write_text("{not json")
    assert main([str(bad)]) == 2
    assert "not valid JSON" in capsys.readouterr().err
    assert main([]) == 2
