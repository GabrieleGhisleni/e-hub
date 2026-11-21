import { describe, expect, it } from "vitest";
import {
  AskChannelExport,
  importTranscript,
  TranscriptChoice,
} from "../src/core/transcript-import";

const id = "RA7tLTZltKI";
const now = new Date("2026-01-01T00:00:00Z");
const sample = {
  video_id: id,
  video_title: "Example video",
  video_url: `https://www.youtube.com/watch?v=${id}`,
  published_at: "2025-01-01T12:00:00Z",
  segment_count: 1,
  segments: [{ start: 1.5, end: 2.8, text: " Example sentence. " }],
};

describe("transcript import", () => {
  it("preserves AskChannel timings and validates the episode association", () => {
    const choice = {
      mode: "paste",
      source: "askchannel",
      data: AskChannelExport.parse(sample),
    } as const;
    expect(importTranscript(choice, id, now)).toMatchObject({
      source: "askchannel",
      timebase: "youtube",
      schemaVersion: 1,
      segments: [{ start: 1.5, end: 2.8, text: "Example sentence." }],
    });
    expect(() => importTranscript(choice, "otherVideo1", now)).toThrow(/altro video/);
  });

  it.each([
    { ...sample, segment_count: 2 },
    { ...sample, video_url: "https://example.org/" },
    { ...sample, segments: [{ ...sample.segments[0], end: 0 }] },
  ])("rejects inconsistent exports", (invalid) => {
    expect(AskChannelExport.safeParse(invalid).success).toBe(false);
  });

  it("normalizes local Whisper with the model and source audio", () => {
    const choice = TranscriptChoice.parse({
      mode: "local",
      data: { videoId: id, model: "base", result: sample },
    });
    if (choice.mode !== "local") throw new Error("Expected local transcription");
    expect(importTranscript(choice, id, now)).toMatchObject({
      source: "whisper-local",
      audio: { source: "youtube", url: sample.video_url },
      extra: { mode: "local", model: "base" },
    });
  });
});
