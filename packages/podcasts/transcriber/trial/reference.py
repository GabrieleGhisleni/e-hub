"""Parse an official lexfridman.com transcript page into reference segments (JSON, cache only)."""
import html, json, re, sys
from pathlib import Path

SEG = re.compile(r'<div class="ts-segment">(.*?)</div>', re.S)


def parse(page: str):
    out = []
    for m in SEG.finditer(page):
        b = m.group(1)
        name = re.search(r'class="ts-name">([^<]*)', b)
        ts = re.search(r'ts-timestamp"><a href="[^"]*[?&](?:#038;|amp;)?t=(\d+)', b)
        txt = re.search(r'class="ts-text">(.*?)</span>', b, re.S)
        if not (name and ts and txt):
            continue
        out.append({"speaker": html.unescape(name.group(1)).strip(), "start": int(ts.group(1)),
                    "text": html.unescape(re.sub(r"<[^>]+>", "", txt.group(1))).strip()})
    return out


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    segs = parse(src.read_text())
    vid = re.search(r"youtube\.com/watch\?v=([\w-]{11})", src.read_text()).group(1)
    dst.write_text(json.dumps({"youtubeId": vid, "segments": segs}, indent=1))
    print(vid, len(segs), "segments; first", segs[0]["start"], "last", segs[-1]["start"])
