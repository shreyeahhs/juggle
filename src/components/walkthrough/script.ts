/**
 * The walkthrough timeline, as data.
 *
 * Keeping the script separate from the player means the sequence can be read,
 * reviewed and tested without reading animation code, and the player stays a
 * generic compiler: it resolves ids to elements, measures pointer targets from
 * the live DOM, and emits one Web Animations track per element and property
 * group. Nothing here knows about pixels, so the same script drives the phone
 * layout and the desktop one.
 *
 * Times are milliseconds from the start of the whole run.
 */

/** A pointer destination, named rather than positioned. The player measures it. */
export type Anchor = "center" | "text-end";

export type Cue =
  /** Move the pointer to an element carrying `data-target`. */
  | { t: "move"; at: number; dur: number; target: string; anchor?: Anchor }
  /** A click: the pointer contracts, and the named element flashes if given. */
  | { t: "press"; at: number; target?: string }
  /** Reveal a monospace string character by character, with a caret. */
  | { t: "type"; at: number; dur: number; id: string }
  /** Fade and rise into place. */
  | { t: "enter"; at: number; dur: number; id: string }
  /** Cross-fade a layer in or out. */
  | { t: "show"; at: number; dur: number; id: string }
  | { t: "hide"; at: number; dur: number; id: string }
  /** Scale a bar horizontally to a fraction of its track. */
  | { t: "grow"; at: number; dur: number; id: string; to: number }
  /** Step a marker down a column of rows, to show the rotation advancing. */
  | { t: "step"; at: number; dur: number; id: string; rows: number[] };

export interface Chapter {
  id: string;
  /** Shown in the chapter bar. Numbered there, because this is a procedure. */
  title: string;
  /** What the viewer should take away. Sits beside the stage. */
  note: string;
  start: number;
  end: number;
}

export interface Script {
  total: number;
  chapters: Chapter[];
  cues: Cue[];
}

/** Row pitch for the pool marker, in rows rather than pixels. */
const POOL_ROWS = [0, 1, 2, 3, 4, 0, 2, 3];

export const WALKTHROUGH: Script = {
  total: 30_000,
  chapters: [
    {
      id: "stage-env",
      title: "Add your keys",
      note: "Every provider key goes into one variable, comma separated. Ten keys is one line, and nothing is stored anywhere but your own environment.",
      start: 0,
      end: 11_000,
    },
    {
      id: "stage-pool",
      title: "Watch it rotate",
      note: "The gateway moves to a different key on every request rather than waiting for a failure. When a provider throttles one, the next key answers and the tired one cools off.",
      start: 11_000,
      end: 20_500,
    },
    {
      id: "stage-code",
      title: "Point your app",
      note: "Two lines change: the base URL and the key. Every OpenAI-compatible client works unmodified, so the request code you already wrote stays exactly as it is.",
      start: 20_500,
      end: 30_000,
    },
  ],
  cues: [
    // 1. Pasting the keys into a deployment's environment.
    { t: "show", at: 0, dur: 450, id: "stage-env" },
    { t: "move", at: 650, dur: 850, target: "env-keys", anchor: "text-end" },
    { t: "press", at: 1_550, target: "env-keys" },
    { t: "type", at: 1_800, dur: 3_100, id: "env-keys-value" },
    { t: "move", at: 5_150, dur: 700, target: "env-token", anchor: "text-end" },
    { t: "press", at: 5_900, target: "env-token" },
    { t: "type", at: 6_100, dur: 1_700, id: "env-token-value" },
    { t: "move", at: 8_000, dur: 700, target: "env-save", anchor: "center" },
    { t: "press", at: 8_750, target: "env-save" },
    { t: "enter", at: 9_050, dur: 500, id: "env-receipt" },
    // Nothing to click in the next scene, so the pointer leaves rather than
    // hovering over empty space for nine seconds.
    { t: "hide", at: 9_600, dur: 350, id: "cursor" },
    { t: "hide", at: 10_600, dur: 400, id: "stage-env" },

    // 2. The pool under load. Bars fill, one key gets throttled, traffic moves.
    { t: "show", at: 11_000, dur: 450, id: "stage-pool" },
    { t: "grow", at: 11_400, dur: 900, id: "pool-bar-1", to: 0.22 },
    { t: "grow", at: 11_650, dur: 900, id: "pool-bar-2", to: 0.26 },
    { t: "grow", at: 11_900, dur: 900, id: "pool-bar-3", to: 0.17 },
    { t: "grow", at: 12_150, dur: 900, id: "pool-bar-4", to: 0.2 },
    { t: "grow", at: 12_400, dur: 900, id: "pool-bar-5", to: 0.15 },
    { t: "step", at: 12_900, dur: 5_000, id: "pool-marker", rows: POOL_ROWS },
    { t: "show", at: 13_600, dur: 350, id: "pool-heat-2" },
    { t: "hide", at: 13_600, dur: 250, id: "pool-rest-2" },
    { t: "show", at: 13_850, dur: 300, id: "pool-hot-2" },
    // The throttled key stops earning share; the others take it up.
    { t: "grow", at: 14_600, dur: 1_400, id: "pool-bar-1", to: 0.27 },
    { t: "grow", at: 14_800, dur: 1_400, id: "pool-bar-3", to: 0.22 },
    { t: "grow", at: 15_000, dur: 1_400, id: "pool-bar-4", to: 0.26 },
    { t: "grow", at: 15_200, dur: 1_400, id: "pool-bar-5", to: 0.19 },
    { t: "enter", at: 18_100, dur: 500, id: "pool-receipt" },
    { t: "hide", at: 20_100, dur: 400, id: "stage-pool" },

    // 3. Repointing a real SDK call, and the response coming back.
    { t: "show", at: 20_500, dur: 450, id: "stage-code" },
    { t: "show", at: 20_600, dur: 350, id: "cursor" },
    { t: "move", at: 20_950, dur: 800, target: "code-baseurl", anchor: "text-end" },
    { t: "press", at: 21_800, target: "code-baseurl" },
    { t: "show", at: 21_950, dur: 220, id: "code-selection" },
    { t: "hide", at: 22_450, dur: 180, id: "code-selection" },
    { t: "hide", at: 22_450, dur: 180, id: "code-url-old" },
    { t: "type", at: 22_650, dur: 2_200, id: "code-url-new" },
    { t: "move", at: 25_300, dur: 750, target: "code-run", anchor: "center" },
    { t: "press", at: 26_100, target: "code-run" },
    { t: "enter", at: 26_450, dur: 420, id: "term-1" },
    { t: "enter", at: 27_150, dur: 420, id: "term-2" },
    { t: "enter", at: 27_850, dur: 420, id: "term-3" },
  ],
};

/** The chapter containing `time`, clamped to the first and last. */
export function chapterAt(script: Script, time: number): number {
  for (let index = script.chapters.length - 1; index >= 0; index -= 1) {
    if (time >= script.chapters[index]!.start) return index;
  }
  return 0;
}

/** `0:07` style, for the time readout. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
