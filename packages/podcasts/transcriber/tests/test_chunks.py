import numpy as np

from epod_transcriber.chunks import keep_core, nominal_cuts, offset_segments, padded_range, plan_chunks, quietest_time


def words_seg(times, text_prefix="w"):
    words = [{"start": t, "end": t + 0.4, "word": f" {text_prefix}{t:g}"} for t in times]
    return {"start": times[0], "end": times[-1] + 0.4, "text": "".join(w["word"] for w in words).strip(), "words": words}


def test_nominal_cuts_split_into_equal_chunks_of_about_the_target():
    assert nominal_cuts(7403, 600) == [7403 * k / 12 for k in range(1, 12)]
    assert nominal_cuts(180, 600) == []  # short audio: one chunk
    assert nominal_cuts(1000, 600) == [500.0]


def test_plan_covers_the_audio_without_gaps_and_uses_the_cut_finder():
    plan = plan_chunks(1800, 600, find_cut=lambda lo, hi: lo + 7, search=30)
    assert plan[0][0] == 0 and plan[-1][1] == 1800
    assert all(a[1] == b[0] for a, b in zip(plan, plan[1:]))
    assert [c[1] for c in plan[:-1]] == [577, 1177]  # lo = target - 30, + 7
    assert plan_chunks(0, 600) == []
    assert plan_chunks(120, 600) == [(0.0, 120.0)]


def test_plan_clamps_a_bad_cut_into_the_search_window():
    plan = plan_chunks(1200, 600, find_cut=lambda lo, hi: -50, search=10)
    assert plan == [(0.0, 590.0), (590.0, 1200.0)]


def test_quietest_time_finds_the_pause():
    sr = 16000
    rng = np.random.default_rng(0)
    x = rng.normal(0, 0.3, sr * 10).astype(np.float32)
    x[int(6.2 * sr) : int(6.9 * sr)] = 0.0  # a 0.7 s pause at 6.2–6.9 s
    t = quietest_time(x, sr, offset=100.0)
    assert 106.2 <= t <= 106.9


def test_padded_range_is_clamped_to_the_audio():
    assert padded_range((0, 600), 1200, 30, 2) == (0.0, 602)
    assert padded_range((600, 1200), 1200, 30, 2) == (570, 1200)


def test_offset_shifts_segments_and_words():
    [seg] = offset_segments([words_seg([1.0, 2.0])], 100)
    assert seg["start"] == 101 and [w["start"] for w in seg["words"]] == [101, 102]


def test_words_straddling_a_cut_are_kept_exactly_once():
    # two padded chunks around the cut at 10.0 both "hear" the words near it
    cut = 10.0
    left = [words_seg([8.0, 9.0, 9.7, 10.5, 11.0])]  # chunk 1 transcribed up to 12 s
    right = [words_seg([9.0, 9.7, 10.5, 11.0, 13.0])]  # chunk 2 transcribed from 8 s
    a = keep_core(left, (0, cut), first=True, last=False)
    b = keep_core(right, (cut, 20), first=False, last=True)
    kept = [w["word"] for s in a + b for w in s["words"]]
    # 9.7 + 0.2 = 9.9 < 10 -> left; 10.5 -> right
    assert kept == [" w8", " w9", " w9.7", " w10.5", " w11", " w13"]
    assert a[0]["text"] == "w8 w9 w9.7" and a[0]["end"] == 10.1


def test_first_and_last_chunks_are_open_ended():
    seg = words_seg([-0.1, 50.0])
    assert len(keep_core([seg], (0, 10), first=True, last=False)[0]["words"]) == 1
    assert len(keep_core([seg], (40, 49), first=False, last=True)[0]["words"]) == 1


def test_segments_without_words_use_their_midpoint():
    seg = {"start": 9.0, "end": 12.0, "text": "uh", "words": []}
    assert keep_core([seg], (0, 10), first=True, last=False) == []
    assert keep_core([seg], (10, 20), first=False, last=True) == [seg]
