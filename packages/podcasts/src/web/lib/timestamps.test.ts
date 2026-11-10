import { describe, expect, it } from "vitest";
import { parseTimestamp, timestampVideoId, youtubeWatchUrl } from "./timestamps";

describe("parseTimestamp", () => {
  it("parses [HH:MM:SS] and [MM:SS]", () => {
    expect(parseTimestamp("[01:23:45]")).toBe(5025);
    expect(parseTimestamp("[1:02:03]")).toBe(3723);
    expect(parseTimestamp("[00:00:00]")).toBe(0);
    expect(parseTimestamp("[12:34]")).toBe(754);
    expect(parseTimestamp("[2:05]")).toBe(125);
    expect(parseTimestamp("[75:30]")).toBe(4530);
  });

  it("rejects out-of-range or malformed values", () => {
    expect(parseTimestamp("[01:60:00]")).toBeUndefined();
    expect(parseTimestamp("[01:00:60]")).toBeUndefined();
    expect(parseTimestamp("[12:61]")).toBeUndefined();
    expect(parseTimestamp("[1:2:3]")).toBeUndefined();
    expect(parseTimestamp("01:23:45")).toBeUndefined();
    expect(parseTimestamp("[123:45:00]")).toBeUndefined();
  });
});

describe("timestampVideoId (timebase rule)", () => {
  it("links only with a youtube timebase and a video id", () => {
    expect(timestampVideoId({ youtubeId: "abcdefghijk", transcriptTimebase: "youtube" })).toBe(
      "abcdefghijk",
    );
    expect(
      timestampVideoId({ youtubeId: "abcdefghijk", transcriptTimebase: "feed" }),
    ).toBeUndefined();
    expect(timestampVideoId({ youtubeId: "abcdefghijk" })).toBeUndefined();
    expect(timestampVideoId({ transcriptTimebase: "youtube" })).toBeUndefined();
  });
});

describe("youtubeWatchUrl", () => {
  it("adds the start time in seconds", () => {
    expect(youtubeWatchUrl("abcdefghijk", 5025)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=5025s",
    );
    expect(youtubeWatchUrl("abcdefghijk")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  });
});
