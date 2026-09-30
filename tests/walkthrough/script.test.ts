import { describe, expect, it } from "vitest";
import { chapterAt, formatClock, WALKTHROUGH, type Cue } from "@/components/walkthrough/script";

/**
 * The walkthrough timeline is data, and the player trusts it: a cue that runs
 * past the end, or one that sits outside the chapter whose button the viewer
 * clicked, produces a stage that silently does nothing. These are the invariants
 * that keep editing the script safe.
 */

const { chapters, cues, total } = WALKTHROUGH;

/** When a cue occupies time. `press` is an instant, so it has no duration. */
function span(cue: Cue): { start: number; end: number } {
  const start = cue.at;
  return { start, end: cue.t === "press" ? start : start + cue.dur };
}

describe("walkthrough chapters", () => {
  it("covers the whole run with no gap and no overlap", () => {
    expect(chapters[0]?.start).toBe(0);
    expect(chapters.at(-1)?.end).toBe(total);

    for (const [index, chapter] of chapters.entries()) {
      expect(chapter.end).toBeGreaterThan(chapter.start);
      const next = chapters[index + 1];
      if (next) expect(next.start).toBe(chapter.end);
    }
  });

  it("resolves a time to the chapter that contains it", () => {
    for (const [index, chapter] of chapters.entries()) {
      expect(chapterAt(WALKTHROUGH, chapter.start)).toBe(index);
      expect(chapterAt(WALKTHROUGH, chapter.end - 1)).toBe(index);
    }
    // Seeking to the very end lands on the last chapter rather than past it.
    expect(chapterAt(WALKTHROUGH, total)).toBe(chapters.length - 1);
    expect(chapterAt(WALKTHROUGH, -1)).toBe(0);
  });

  it("gives every chapter a title and a note to show beside the stage", () => {
    for (const chapter of chapters) {
      expect(chapter.title.length).toBeGreaterThan(0);
      expect(chapter.note.length).toBeGreaterThan(0);
    }
  });
});

describe("walkthrough cues", () => {
  it("keeps every cue inside the run", () => {
    for (const cue of cues) {
      const { start, end } = span(cue);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(total);
    }
  });

  it("gives every timed cue a positive duration", () => {
    for (const cue of cues) {
      if (cue.t === "press") continue;
      expect(cue.dur).toBeGreaterThan(0);
    }
  });

  it("starts every cue inside the chapter it belongs to", () => {
    // Otherwise jumping to a chapter would show a scene whose action already ran.
    for (const cue of cues) {
      const { start } = span(cue);
      const chapter = chapters.find((item) => start >= item.start && start < item.end);
      expect(chapter, `cue ${cue.t} at ${start}ms falls outside every chapter`).toBeDefined();
    }
  });

  it("never runs two cues of the same kind on one element at the same time", () => {
    // Overlapping cues on one property fight, and the loser is silently dropped.
    const byTrack = new Map<string, Array<{ start: number; end: number }>>();
    for (const cue of cues) {
      if (cue.t === "move" || cue.t === "press") continue;
      const key = `${cue.id}|${cue.t === "show" || cue.t === "hide" || cue.t === "enter" ? "visibility" : cue.t}`;
      const list = byTrack.get(key) ?? [];
      list.push(span(cue));
      byTrack.set(key, list);
    }

    for (const [key, spans] of byTrack) {
      spans.sort((a, b) => a.start - b.start);
      for (let index = 1; index < spans.length; index += 1) {
        expect(spans[index]!.start, `overlapping cues on ${key}`).toBeGreaterThanOrEqual(spans[index - 1]!.end);
      }
    }
  });

  it("only ever grows a bar forward", () => {
    // A bar that shrank would read as traffic being taken away from a key.
    const reached = new Map<string, number>();
    for (const cue of cues) {
      if (cue.t !== "grow") continue;
      expect(cue.to).toBeGreaterThan(reached.get(cue.id) ?? 0);
      expect(cue.to).toBeLessThanOrEqual(1);
      reached.set(cue.id, cue.to);
    }
    expect(reached.size).toBeGreaterThan(0);
  });

  it("moves the pointer before pressing, so a click always has a target under it", () => {
    let moved = false;
    for (const cue of cues) {
      if (cue.t === "move") moved = true;
      if (cue.t === "press") expect(moved, "a press happens before the first move").toBe(true);
    }
  });

  it("steps the rotation marker only over rows the pool stage renders", () => {
    const POOL_ROW_COUNT = 5;
    for (const cue of cues) {
      if (cue.t !== "step") continue;
      expect(cue.rows.length).toBeGreaterThan(0);
      for (const row of cue.rows) {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(POOL_ROW_COUNT);
      }
    }
  });
});

describe("formatClock", () => {
  it("renders minutes and padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_400)).toBe("0:07");
    expect(formatClock(30_000)).toBe("0:30");
    expect(formatClock(61_000)).toBe("1:01");
  });

  it("never shows a negative position", () => {
    expect(formatClock(-500)).toBe("0:00");
  });
});
