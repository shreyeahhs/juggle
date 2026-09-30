"use client";

import { ArrowCounterClockwiseIcon, CursorClickIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react/ssr";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { chapterAt, formatClock, WALKTHROUGH, type Anchor, type Cue, type Script } from "./script";
import { CodeStage, EnvStage, PoolStage } from "./stages";

/**
 * The walkthrough player.
 *
 * The animation is compiled from `script.ts` into Web Animations tracks rather
 * than assembled by hand, which buys three things a pile of CSS keyframes would
 * not: one shared clock, so scrubbing is exact; pointer paths measured from the
 * live DOM, so the same script is correct at every breakpoint; and interruption,
 * so pausing and seeking behave.
 *
 * Every track spans the full run and carries absolute offsets. That means
 * seeking is `currentTime = t` on each one, with no per-cue bookkeeping, and no
 * track can reset another by holding its own first frame.
 *
 * No animation library: the platform expresses this cleanly, and this project
 * is meant to stay cheap for people self-hosting it.
 */

const EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
const IN_QUAD = "cubic-bezier(0.4, 0, 1, 1)";
/** Hold the current value, then switch at the end of the interval. */
const HOLD = "steps(1, jump-end)";

/** Groups that can animate independently on one element without conflicting. */
type PropGroup = "transform" | "opacity" | "clipPath";

interface Frame {
  time: number;
  value: Record<string, string | number>;
  easing?: string;
}

class TrackSet {
  private readonly tracks = new Map<Element, Map<PropGroup, Frame[]>>();

  add(el: Element | null | undefined, group: PropGroup, ...frames: Frame[]): void {
    if (!el) return;
    let groups = this.tracks.get(el);
    if (!groups) {
      groups = new Map();
      this.tracks.set(el, groups);
    }
    const existing = groups.get(group);
    if (existing) existing.push(...frames);
    else groups.set(group, [...frames]);
  }

  /** Emits one paused animation per element and property group. */
  build(total: number): Animation[] {
    const animations: Animation[] = [];
    for (const [el, groups] of this.tracks) {
      for (const frames of groups.values()) {
        frames.sort((a, b) => a.time - b.time);
        const first = frames[0];
        const last = frames[frames.length - 1];
        if (!first || !last) continue;

        // Anchor both ends so the element holds a defined value for the whole run.
        if (first.time > 0) frames.unshift({ time: 0, value: first.value, easing: HOLD });
        if (last.time < total) frames.push({ time: total, value: last.value });

        const keyframes: Keyframe[] = frames.map((frame) => ({
          offset: Math.min(1, Math.max(0, frame.time / total)),
          easing: frame.easing,
          ...frame.value,
        }));

        const animation = el.animate(keyframes, { duration: total, fill: "both" });
        animation.pause();
        animations.push(animation);
      }
    }
    return animations;
  }
}

interface Point {
  x: number;
  y: number;
}

function centreOf(deck: HTMLElement, el: Element, anchor: Anchor): Point {
  const frame = deck.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return {
    // Aiming just inside a field reads as "click here to type"; buttons get their centre.
    x: box.left - frame.left + (anchor === "text-end" ? 18 : box.width / 2),
    y: box.top - frame.top + box.height / 2,
  };
}

function warnMissing(what: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[walkthrough] no element for ${what}; the cue was skipped.`);
  }
}

/** Turns the script into paused animations against the live stage. */
function compile(script: Script, deck: HTMLElement): Animation[] {
  const set = new TrackSet();
  const byId = (id: string) => deck.querySelector<HTMLElement>(`[data-anim="${id}"]`);
  const byTarget = (name: string) => deck.querySelector<HTMLElement>(`[data-target="${name}"]`);

  const cursor = byId("cursor");
  const cursorTip = byId("cursor-tip");

  // Bars can be grown more than once, so each id keeps a running value.
  const grown = new Map<string, number>();
  let pointer: Point | null = null;

  const moves = script.cues.filter((cue): cue is Extract<Cue, { t: "move" }> => cue.t === "move");
  const firstMove = moves[0];
  if (cursor && firstMove) {
    const target = byTarget(firstMove.target);
    if (target) {
      // Drift in from off the target rather than materialising on top of it.
      const destination = centreOf(deck, target, firstMove.anchor ?? "center");
      pointer = { x: destination.x - 52, y: destination.y + 40 };
      set.add(cursor, "transform", { time: 0, value: { transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }, easing: EXPO });
      set.add(
        cursor,
        "opacity",
        { time: Math.max(0, firstMove.at - 250), value: { opacity: 0 }, easing: EXPO },
        { time: firstMove.at + 250, value: { opacity: 1 } },
      );
    }
  }

  for (const cue of script.cues) {
    switch (cue.t) {
      case "move": {
        const target = byTarget(cue.target);
        if (!target || !cursor || !pointer) {
          if (!target) warnMissing(`target "${cue.target}"`);
          break;
        }
        const to = centreOf(deck, target, cue.anchor ?? "center");
        set.add(
          cursor,
          "transform",
          { time: cue.at, value: { transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }, easing: EXPO },
          { time: cue.at + cue.dur, value: { transform: `translate3d(${to.x}px, ${to.y}px, 0)` } },
        );
        pointer = to;
        break;
      }

      case "press": {
        if (cursorTip) {
          set.add(
            cursorTip,
            "transform",
            { time: cue.at, value: { scale: 1 }, easing: IN_QUAD },
            { time: cue.at + 90, value: { scale: 0.78 }, easing: EXPO },
            { time: cue.at + 300, value: { scale: 1 } },
          );
        }
        if (cue.target) {
          const flash = deck.querySelector<HTMLElement>(`[data-flash="${cue.target}"]`);
          set.add(
            flash,
            "opacity",
            { time: cue.at, value: { opacity: 0 }, easing: EXPO },
            { time: cue.at + 110, value: { opacity: 1 }, easing: EXPO },
            { time: cue.at + 620, value: { opacity: 0 } },
          );
        }
        break;
      }

      case "type": {
        const el = byId(cue.id);
        if (!el) {
          warnMissing(`typed text "${cue.id}"`);
          break;
        }
        const chars = Math.max(1, (el.textContent ?? "").length);
        // A clip in whole-character steps: the reveal lands on glyph boundaries.
        set.add(
          el,
          "clipPath",
          { time: cue.at, value: { clipPath: "inset(0 100% 0 0)" }, easing: `steps(${chars}, jump-start)` },
          { time: cue.at + cue.dur, value: { clipPath: "inset(0 0% 0 0)" } },
        );

        const caret = byId(`${cue.id}-caret`);
        if (caret) {
          set.add(
            caret,
            "transform",
            { time: cue.at, value: { transform: "translateX(0ch)" }, easing: `steps(${chars}, jump-start)` },
            { time: cue.at + cue.dur, value: { transform: `translateX(${chars}ch)` } },
          );
          set.add(
            caret,
            "opacity",
            { time: Math.max(0, cue.at - 120), value: { opacity: 0 }, easing: HOLD },
            { time: cue.at, value: { opacity: 1 }, easing: HOLD },
            { time: cue.at + cue.dur + 450, value: { opacity: 1 }, easing: HOLD },
            { time: cue.at + cue.dur + 500, value: { opacity: 0 } },
          );
        }
        break;
      }

      case "enter": {
        const el = byId(cue.id);
        if (!el) {
          warnMissing(`entering element "${cue.id}"`);
          break;
        }
        set.add(
          el,
          "opacity",
          { time: cue.at, value: { opacity: 0 }, easing: EXPO },
          { time: cue.at + cue.dur, value: { opacity: 1 } },
        );
        set.add(
          el,
          "transform",
          { time: cue.at, value: { transform: "translate3d(0, 5px, 0)" }, easing: EXPO },
          { time: cue.at + cue.dur, value: { transform: "translate3d(0, 0, 0)" } },
        );
        break;
      }

      case "show":
      case "hide": {
        const el = byId(cue.id);
        if (!el) {
          warnMissing(`layer "${cue.id}"`);
          break;
        }
        const from = cue.t === "show" ? 0 : 1;
        set.add(
          el,
          "opacity",
          { time: cue.at, value: { opacity: from }, easing: cue.t === "show" ? EXPO : IN_QUAD },
          { time: cue.at + cue.dur, value: { opacity: 1 - from } },
        );
        break;
      }

      case "grow": {
        const el = byId(cue.id);
        if (!el) {
          warnMissing(`bar "${cue.id}"`);
          break;
        }
        const from = grown.get(cue.id) ?? 0;
        set.add(
          el,
          "transform",
          { time: cue.at, value: { transform: `scaleX(${from})` }, easing: EXPO },
          { time: cue.at + cue.dur, value: { transform: `scaleX(${cue.to})` } },
        );
        grown.set(cue.id, cue.to);
        break;
      }

      case "step": {
        const el = byId(cue.id);
        if (!el) {
          warnMissing(`marker "${cue.id}"`);
          break;
        }
        const rows = Array.from(deck.querySelectorAll<HTMLElement>("[data-row]"));
        const origin = rows[0]?.getBoundingClientRect().top;
        if (origin === undefined) break;

        const hold = cue.dur / cue.rows.length;
        const offsets = cue.rows.map((row) => {
          const box = rows[row]?.getBoundingClientRect();
          return box ? box.top - origin : 0;
        });

        set.add(
          el,
          "transform",
          ...offsets.map((offset, index) => ({
            time: cue.at + index * hold,
            value: { transform: `translate3d(0, ${offset}px, 0)` },
            // Discrete hops: the marker rests on a key, then jumps to the next.
            easing: HOLD,
          })),
        );
        set.add(
          el,
          "opacity",
          { time: cue.at, value: { opacity: 0 }, easing: EXPO },
          { time: cue.at + 260, value: { opacity: 1 }, easing: HOLD },
          { time: cue.at + cue.dur, value: { opacity: 1 }, easing: IN_QUAD },
          { time: cue.at + cue.dur + 320, value: { opacity: 0 } },
        );
        break;
      }
    }
  }

  return set.build(script.total);
}

function readTime(animation: Animation): number {
  const time = animation.currentTime;
  if (time === null) return 0;
  return typeof time === "number" ? time : ((time as CSSUnitValue).value ?? 0);
}

/** The still version: every step in its finished state, with its explanation. */
function StillWalkthrough({ className }: { className?: string }) {
  return (
    <ol className={cn("grid gap-6 md:grid-cols-3 md:gap-5", className)}>
      {WALKTHROUGH.chapters.map((chapter, index) => {
        const Stage = [EnvStage, PoolStage, CodeStage][index]!;
        return (
          <li key={chapter.id} className="space-y-3">
            <Stage snapshot />
            <div className="space-y-1.5">
              <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">
                <span className="font-mono text-heat-ink">{index + 1}.</span> {chapter.title}
              </h3>
              <p className="text-[13px] leading-relaxed text-ink-muted">{chapter.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Deck({ script }: { script: Script }) {
  const deckRef = useRef<HTMLDivElement>(null);
  const animationsRef = useRef<Animation[]>([]);
  const scrubRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);
  /** A pause the viewer asked for is respected when the section scrolls back. */
  const userPausedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [ended, setEnded] = useState(false);

  const paint = useCallback(
    (time: number) => {
      const pct = script.total ? (time / script.total) * 100 : 0;
      if (scrubRef.current) {
        scrubRef.current.value = String(Math.round(time));
        scrubRef.current.style.setProperty("--p", `${pct}%`);
      }
      if (clockRef.current) clockRef.current.textContent = formatClock(time);
      setChapter((current) => {
        const next = chapterAt(script, time);
        return next === current ? current : next;
      });
    },
    [script],
  );

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.min(script.total, Math.max(0, time));
      for (const animation of animationsRef.current) animation.currentTime = clamped;
      setEnded(clamped >= script.total);
      paint(clamped);
    },
    [paint, script.total],
  );

  const play = useCallback(() => {
    const animations = animationsRef.current;
    if (!animations.length) return;
    if (readTime(animations[0]!) >= script.total) seek(0);
    for (const animation of animations) animation.play();
    userPausedRef.current = false;
    setPlaying(true);
    setEnded(false);
  }, [script.total, seek]);

  const pause = useCallback((byUser = false) => {
    for (const animation of animationsRef.current) animation.pause();
    if (byUser) userPausedRef.current = true;
    setPlaying(false);
  }, []);

  // Build before paint so the stage never shows all three scenes at once.
  useLayoutEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;

    let frame = 0;
    const build = () => {
      const previous = animationsRef.current[0];
      const resumeAt = previous ? readTime(previous) : 0;
      const wasPlaying = previous?.playState === "running";

      for (const animation of animationsRef.current) animation.cancel();
      animationsRef.current = compile(script, deck);
      for (const animation of animationsRef.current) animation.currentTime = resumeAt;
      if (wasPlaying) for (const animation of animationsRef.current) animation.play();
      paint(resumeAt);
    };

    build();

    // Pointer paths are measured in pixels, so a resize invalidates them.
    let width = deck.clientWidth;
    const observer = new ResizeObserver(() => {
      if (deck.clientWidth === width) return;
      width = deck.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(build);
    });
    observer.observe(deck);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const animation of animationsRef.current) animation.cancel();
      animationsRef.current = [];
    };
  }, [paint, script]);

  // One loop drives the scrubber and the clock, writing to the DOM directly so
  // a 30 second run does not re-render React 1800 times.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const first = animationsRef.current[0];
      if (!first) return;
      const time = readTime(first);
      paint(time);
      if (time >= script.total) {
        pause();
        setEnded(true);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paint, pause, playing, script.total]);

  // Autoplay when the stage is actually on screen, and stop when it is not.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!userPausedRef.current) play();
        } else {
          pause();
        }
      },
      { threshold: 0.45 },
    );
    observer.observe(deck);
    return () => observer.disconnect();
  }, [pause, play]);

  // A run nobody can see is wasted work and a wasted battery.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pause]);

  const current = WALKTHROUGH.chapters[chapter];

  return (
    <div className="space-y-3">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-7">
        <div>
          {/*
            The stage is decorative in the accessibility tree: the same content
            is in the chapter list and the note beside it, in text.
          */}
          <div
            ref={deckRef}
            aria-hidden
            // Height is set to the tallest scene rather than an aspect ratio: a 16/9
            // box left each scene floating in a pool of empty canvas.
            className="relative h-80 overflow-hidden rounded-sharp border border-line bg-canvas sm:h-[22rem]"
          >
            <div data-anim="stage-env" className="absolute inset-0 grid place-items-center p-2.5 sm:p-3">
              <EnvStage />
            </div>
            <div data-anim="stage-pool" className="absolute inset-0 grid place-items-center p-2.5 opacity-0 sm:p-3">
              <PoolStage />
            </div>
            <div data-anim="stage-code" className="absolute inset-0 grid place-items-center p-2.5 opacity-0 sm:p-3">
              <CodeStage />
            </div>

            <span data-anim="cursor" className="pointer-events-none absolute top-0 left-0 z-20 opacity-0">
              <span data-anim="cursor-tip" className="block origin-top-left">
                <CursorClickIcon size={20} weight="fill" className="text-ink drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />
              </span>
            </span>
          </div>

          <Transport
            chapter={chapter}
            clockRef={clockRef}
            ended={ended}
            onChapter={(index) => {
              seek(WALKTHROUGH.chapters[index]!.start);
              play();
            }}
            onScrub={(value) => {
              pause(true);
              seek(value);
            }}
            onToggle={() => (playing ? pause(true) : play())}
            playing={playing}
            scrubRef={scrubRef}
            total={script.total}
          />
        </div>

        <p aria-live="polite" className="text-[13px] leading-relaxed text-ink-muted lg:pt-1">
          <span className="mb-1 block text-[13.5px] font-semibold text-ink">
            <span className="font-mono text-heat-ink">{chapter + 1}.</span> {current?.title}
          </span>
          {current?.note}
        </p>
      </div>
    </div>
  );
}

function Transport({
  chapter,
  clockRef,
  ended,
  onChapter,
  onScrub,
  onToggle,
  playing,
  scrubRef,
  total,
}: {
  chapter: number;
  clockRef: React.RefObject<HTMLSpanElement | null>;
  ended: boolean;
  onChapter: (index: number) => void;
  onScrub: (value: number) => void;
  onToggle: () => void;
  playing: boolean;
  scrubRef: React.RefObject<HTMLInputElement | null>;
  total: number;
}) {
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-sharp border border-line-strong bg-surface text-ink",
            "transition-colors duration-150 hover:bg-surface-muted active:translate-y-px",
          )}
        >
          {ended ? <ArrowCounterClockwiseIcon size={14} /> : playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
          <span className="sr-only">{ended ? "Replay the walkthrough" : playing ? "Pause the walkthrough" : "Play the walkthrough"}</span>
        </button>

        {/*
          A real range input: keyboard, touch and assistive technology support
          come for free, which a div with a drag handler would have to fake.
        */}
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={total}
          step={50}
          defaultValue={0}
          aria-label="Walkthrough position"
          onChange={(event) => onScrub(Number(event.target.value))}
          className={cn(
            "h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-sharp",
            "[background:linear-gradient(to_right,var(--color-heat)_var(--p,0%),var(--color-line)_var(--p,0%))]",
            "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-canvas [&::-webkit-slider-thumb]:bg-ink",
            "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-canvas [&::-moz-range-thumb]:bg-ink",
          )}
        />

        <span ref={clockRef} className="w-8 shrink-0 text-right font-mono text-[11px] text-ink-subtle">
          0:00
        </span>
      </div>

      <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-sharp bg-line">
        {WALKTHROUGH.chapters.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onChapter(index)}
              aria-current={index === chapter ? "step" : undefined}
              className={cn(
                "flex w-full items-baseline gap-1.5 px-2 py-1.5 text-left transition-colors duration-150",
                index === chapter ? "bg-surface text-ink" : "bg-canvas text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              <span className={cn("font-mono text-[10.5px]", index === chapter ? "text-heat-ink" : "text-ink-subtle")}>{index + 1}</span>
              <span className="truncate text-[12px] font-medium">{item.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Renders the still version on the server, then swaps in the player once the
 * section is near the viewport. Reduced motion never swaps, so that reader gets
 * the complete walkthrough as three finished frames and their explanations.
 */
export function Walkthrough({ className }: { className?: string }) {
  const [armed, setArmed] = useState(false);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (typeof window === "undefined" || !("animate" in Element.prototype)) return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (query.matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setArmed(true);
          observer.disconnect();
        }
      },
      // Arm before it is visible, so the swap happens off screen.
      { rootMargin: "400px 0px" },
    );
    observer.observe(holder);

    const onChange = () => {
      if (query.matches) setArmed(false);
    };
    query.addEventListener("change", onChange);

    return () => {
      observer.disconnect();
      query.removeEventListener("change", onChange);
    };
  }, []);

  return (
    <div ref={holderRef} className={className}>
      {armed ? <Deck script={WALKTHROUGH} /> : <StillWalkthrough />}
    </div>
  );
}
