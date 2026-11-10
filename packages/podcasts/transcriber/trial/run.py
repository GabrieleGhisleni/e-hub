"""Phase-2 trial: faster-whisper small.en + diarize on a WAV, then compare with the official transcript.

Usage (from transcriber/):  uv run python trial/run.py {asr|diarize|merge|eval} [--wav PATH]
Outputs go to data/cache/trial/ (gitignored).
"""
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/cache/trial"
PROMPT = "Lex Fridman Podcast. Conversation between Lex Fridman and Andrew Scull about psychiatry, asylums, ECT, lobotomies, Freud and Jung."
SPAN = 1200.0
TAG = os.environ.get("TRIAL_TAG", "")


def load():
    return os.getloadavg()


def stamp(label, t0):
    d = time.perf_counter() - t0
    print(f"{label}: {d:.1f}s  load before/after: see below  loadavg={os.getloadavg()}", flush=True)
    return d


def asr(wav, batched=True, vad=True):
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    l0 = load()
    t0 = time.perf_counter()
    model = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=8)
    pipe = BatchedInferencePipeline(model)
    t_load = time.perf_counter() - t0
    t1 = time.perf_counter()
    if batched:
        segs, info = pipe.transcribe(str(wav), batch_size=8, word_timestamps=True, initial_prompt=PROMPT, language="en")
    else:  # sequential decoder, for comparison
        segs, info = model.transcribe(str(wav), word_timestamps=True, initial_prompt=PROMPT, language="en", vad_filter=vad)
    out = []
    for s in segs:
        out.append({"start": s.start, "end": s.end, "text": s.text.strip(),
                    "words": [{"start": w.start, "end": w.end, "word": w.word} for w in s.words or []]})
    t_tr = time.perf_counter() - t1
    l1 = load()
    res = {"model_load_s": t_load, "transcribe_s": t_tr, "audio_s": info.duration, "rtf": t_tr / info.duration,
           "load_before": l0, "load_after": l1, "segments": out}
    (OUT / f"asr{TAG}.json").write_text(json.dumps(res))
    print({k: v for k, v in res.items() if k != "segments"})


def diar(wav):
    from diarize import diarize
    l0 = load()
    t0 = time.perf_counter()
    r = diarize(str(wav), num_speakers=2)
    t = time.perf_counter() - t0
    res = {"diarize_s": t, "load_before": l0, "load_after": load(),
           "segments": [{"start": s.start, "end": s.end, "speaker": s.speaker} for s in r.segments]}
    (OUT / "diarize.json").write_text(json.dumps(res))
    print({k: v for k, v in res.items() if k != "segments"}, "n_turns", len(res["segments"]))


def speaker_at(turns, a, b):
    """speaker with the largest overlap with [a,b]; None if no overlap."""
    best, bo = None, 0.0
    for t in turns:
        o = min(b, t["end"]) - max(a, t["start"])
        if o > bo:
            best, bo = t["speaker"], o
    return best


def merge():
    a = json.loads((OUT / f"asr{TAG}.json").read_text())["segments"]
    turns = json.loads((OUT / "diarize.json").read_text())["segments"]
    # per-word speaker; words with no overlap take the nearest-in-time previous speaker
    words = []
    last = None
    for s in a:
        for w in s["words"]:
            sp = speaker_at(turns, w["start"], w["end"]) or last
            last = sp or last
            words.append({**w, "speaker": sp})
    # split Whisper segments where speaker changes
    out = []
    i = 0
    for s in a:
        n = len(s["words"])
        ws = words[i:i + n]
        i += n
        cur = None
        for w in ws:
            if cur is None or w["speaker"] != cur["speaker"]:
                cur = {"speaker": w["speaker"], "start": w["start"], "end": w["end"], "text": ""}
                out.append(cur)
            cur["text"] += w["word"]
            cur["end"] = w["end"]
    for o in out:
        o["text"] = o["text"].strip()
    # host heuristic: first speaker = host
    order = []
    for o in out:
        if o["speaker"] and o["speaker"] not in order:
            order.append(o["speaker"])
    names = {sp: ("Lex Fridman" if k == 0 else f"Guest {k}") for k, sp in enumerate(order)}
    for o in out:
        o["name"] = names.get(o["speaker"])
    for w in words:
        w["name"] = names.get(w["speaker"])
    (OUT / f"merged{TAG}.json").write_text(json.dumps({"names": names, "segments": out, "words": words}))
    print("segments", len(out), "names", names)


def norm(t):
    t = t.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return re.sub(r"\s+", " ", t.replace("-", " ")).strip()


def evaluate():
    import jiwer
    ref = json.loads((OUT / "reference_full.json").read_text())["segments"]
    ref = [r for r in ref if r["start"] < SPAN]
    m = json.loads((OUT / f"merged{TAG}.json").read_text())
    hyp_words = [w for w in m["words"] if w["start"] < SPAN]
    # reference words with time interpolated linearly within each official segment
    rw = []
    for i, r in enumerate(ref):
        end = ref[i + 1]["start"] if i + 1 < len(ref) else SPAN
        toks = norm(r["text"]).split()
        for k, tk in enumerate(toks):
            rw.append({"w": tk, "t": r["start"] + (end - r["start"]) * (k + 0.5) / max(len(toks), 1), "speaker": r["speaker"]})
    # cut ref at SPAN (last segment may extend past): keep words with t<SPAN
    rw = [x for x in rw if x["t"] < SPAN]
    # trim hypothesis to ref's last word time to align spans
    last_t = rw[-1]["t"]
    hyp = [(norm(w["word"]), w) for w in hyp_words if w["start"] < last_t]
    hyp_t = " ".join(x for x, _ in hyp if x)
    ref_t = " ".join(x["w"] for x in rw)
    wer = jiwer.wer(ref_t, hyp_t)
    o = jiwer.process_words(ref_t, hyp_t)
    # speaker accuracy: word alignment ref<->hyp, compare speakers on matched words
    hl = [(x, w) for x, w in hyp for x in x.split() or []]
    hl = [(x, w) for tok, w in hyp for x in tok.split()]
    hyp_tokens = [x for x, _ in hl]
    ref_tokens = [x["w"] for x in rw]
    o2 = jiwer.process_words(" ".join(ref_tokens), " ".join(hyp_tokens))
    ok = tot = 0
    guest_name = next(n for n in dict.fromkeys(x["speaker"] for x in rw) if n != "Lex Fridman")
    # (guest names are unknown to the heuristic: "Guest N" is mapped to the one official guest)
    # map official names -> hyp names
    for chunk in o2.alignments[0]:
        if chunk.type != "equal":
            continue
        for k in range(chunk.ref_end_idx - chunk.ref_start_idx):
            r = rw[chunk.ref_start_idx + k]
            h = hl[chunk.hyp_start_idx + k][1]
            tot += 1
            ok += (r["speaker"] == (guest_name if (h.get("name") or "").startswith("Guest") else h.get("name")))
    # also with swapped labeling (best of 2 mappings) to decouple from host heuristic
    swapped_ok = 0
    names = {r["speaker"] for r in rw}
    dels = [(rw[c.ref_start_idx]["t"], c.ref_end_idx - c.ref_start_idx) for c in o2.alignments[0] if c.type == "delete" and c.ref_end_idx - c.ref_start_idx >= 8]
    print("big deletion runs (approx t, words):", [(round(t), n) for t, n in dels])
    res = {"wer": wer, "ref_words": len(ref_t.split()), "hyp_words": len(hyp_t.split()),
           "sub": o.substitutions, "del": o.deletions, "ins": o.insertions,
           "speaker_acc_matched_words": ok / tot, "matched_words": tot,
           "first_ref_speaker": rw[0]["speaker"], "heuristic_names": m["names"]}
    # label-free accuracy: best mapping of diarization labels to official names
    from itertools import permutations
    labs = sorted({w["speaker"] for _, w in hl if w["speaker"]})
    best = 0
    for perm in permutations(sorted(names), len(labs)):
        mp = dict(zip(labs, perm))
        c = 0
        for chunk in o2.alignments[0]:
            if chunk.type != "equal":
                continue
            for k in range(chunk.ref_end_idx - chunk.ref_start_idx):
                c += rw[chunk.ref_start_idx + k]["speaker"] == mp.get(hl[chunk.hyp_start_idx + k][1]["speaker"])
        best = max(best, c)
    res["speaker_acc_best_mapping"] = best / tot
    (OUT / f"eval{TAG}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("stage", choices=["asr", "diarize", "merge", "eval"])
    p.add_argument("--sequential", action="store_true", help="asr: use WhisperModel.transcribe instead of the batched pipeline")
    p.add_argument("--wav", default=str(ROOT / "data/audio/trial.wav"))
    a = p.parse_args()
    {"asr": lambda: asr(a.wav, batched=not a.sequential), "diarize": lambda: diar(a.wav), "merge": merge, "eval": evaluate}[a.stage]()
