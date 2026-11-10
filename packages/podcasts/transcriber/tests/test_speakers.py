from epod_transcriber.speakers import (
    assign_speakers,
    detect_host,
    name_speakers,
    smooth_islands,
    split_segments,
    surname_keys,
    to_transcript_segments,
)


def w(start, end, word):
    return {"start": start, "end": end, "word": word}


TURNS = [
    {"start": 0.0, "end": 5.0, "speaker": "SPEAKER_01"},
    {"start": 5.2, "end": 9.0, "speaker": "SPEAKER_00"},
    {"start": 9.5, "end": 12.0, "speaker": "SPEAKER_01"},
]


def test_each_word_takes_the_turn_it_overlaps_most():
    words = [w(1, 1.5, " a"), w(4.8, 5.4, " b"), w(5.0, 6.0, " c"), w(10, 10.5, " d")]
    # b overlaps 0.2 with SPEAKER_01 and 0.2 with SPEAKER_00 -> first max wins (strictly greater)
    assert assign_speakers(words, TURNS) == ["SPEAKER_01", "SPEAKER_01", "SPEAKER_00", "SPEAKER_01"]


def test_words_in_gaps_take_the_nearest_turn_and_prefer_the_previous_speaker_on_ties():
    words = [w(9.05, 9.1, " gap-near-left"), w(9.4, 9.45, " gap-near-right"), w(20, 20.5, " after-end"), w(3, 3, " zero-length")]
    labels = assign_speakers(words, TURNS)
    assert labels == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_01", "SPEAKER_01"]


def test_unsorted_words_and_no_turns():
    words = [w(10, 10.5, " late"), w(1, 1.5, " early")]
    assert assign_speakers(words, TURNS) == ["SPEAKER_01", "SPEAKER_01"]
    assert assign_speakers(words, []) == [None, None]


def test_smooth_islands_only_fixes_short_interior_flicker():
    words = [w(i, i + 0.3, f" w{i}") for i in range(6)]
    assert smooth_islands(["A", "A", "B", "A", "A", "A"], words) == ["A"] * 6
    # two-word island: kept (could be a real interjection)
    assert smooth_islands(["A", "B", "B", "A", "A", "A"], words) == ["A", "B", "B", "A", "A", "A"]
    # edge runs are speaker changes, not flicker
    assert smooth_islands(["B", "A", "A", "A", "A", "A"], words) == ["B", "A", "A", "A", "A", "A"]
    assert smooth_islands(["A", "A", "A", "A", "A", "B"], words) == ["A", "A", "A", "A", "A", "B"]


def test_segments_are_split_where_the_speaker_changes():
    seg = {
        "start": 3.0,
        "end": 7.0,
        "text": "Right. So what happened?",
        "words": [w(3.0, 3.5, " Right."), w(5.4, 5.8, " So"), w(5.8, 6.2, " what"), w(6.2, 6.8, " happened?")],
    }
    pieces = split_segments([seg], TURNS)
    assert [(p["label"], p["start"], p["text"]) for p in pieces] == [
        ("SPEAKER_01", 3.0, "Right."),
        ("SPEAKER_00", 5.4, "So what happened?"),
    ]


def test_segment_without_words_gets_a_speaker_by_its_interval():
    pieces = split_segments([{"start": 6.0, "end": 8.0, "text": " Hmm. ", "words": []}], TURNS)
    assert pieces == [{"label": "SPEAKER_00", "start": 6.0, "end": 8.0, "text": "Hmm."}]


def piece(label, start, text):
    return {"label": label, "start": start, "end": start + 1, "text": text}


def test_host_is_the_first_speaker_without_a_cold_open():
    pieces = [piece("S1", 0, "The following is a conversation with Jane Doe."), piece("S0", 5, "Thanks for having me.")]
    assert detect_host(pieces, ["Jane Doe"]) == ("S1", "intro-mention")
    assert detect_host(pieces, []) == ("S1", "first-speaker")


def test_cold_open_host_is_who_introduces_the_guest():
    pieces = [
        piece("S0", 0, "And that is why the empire fell."),  # clip of the guest
        piece("S1", 40, "This is a conversation with Dr. Jane Doe's work in mind… Jane Doe, a historian."),
        piece("S0", 300, "It's great to be here."),
    ]
    assert detect_host(pieces, ["Dr. Jane Doe"]) == ("S1", "intro-mention")
    # a mention after the window does not count
    assert detect_host([pieces[0], piece("S1", 700, "Doe")], ["Jane Doe"]) == ("S0", "first-speaker")


def test_surname_keys_ignore_titles_and_suffixes():
    assert surname_keys(["Dr. Jane Q. Doe Jr.", "Ng", "Zoë Ångström"]) == {"doe", "angstrom"}


def test_names_host_then_guests_in_order_then_generic_labels():
    names = name_speakers(["S2", "S0", "S1", "S3"], "S0", "Host Person", ["Guest One", "Guest Two"])
    assert names == {"S0": "Host Person", "S2": "Guest One", "S1": "Guest Two", "S3": "Speaker 4"}
    assert name_speakers(["S0", "S1"], "S0", "Host", []) == {"S0": "Host", "S1": "Speaker 2"}


def test_transcript_segments_in_the_unified_format():
    pieces = [piece("S0", 1.23456, "Hello."), piece(None, 2, "Unknown.")]
    assert to_transcript_segments(pieces, {"S0": "Host"}) == [
        {"speaker": "Host", "start": 1.23, "text": "Hello."},
        {"start": 2, "text": "Unknown."},
    ]
