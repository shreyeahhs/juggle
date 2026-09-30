import { cn } from "@/lib/utils";

/**
 * The three scenes the walkthrough plays through.
 *
 * Each stage renders twice in the page, in two modes. `snapshot` draws the
 * finished state: that is what someone sees with reduced motion on, with
 * JavaScript off, or before the player has built anything. Without it the stage
 * renders its starting state and the player animates it forward. Sharing one
 * component between the two keeps the still version and the moving version from
 * drifting apart.
 *
 * Values shown here are deliberately unmistakable examples. Nothing in this file
 * is a real credential, and the shapes match what the provider actually issues
 * so the walkthrough teaches the right format.
 */

interface StageProps {
  snapshot?: boolean;
}

/** Chrome shared by all three stages, so the scenes read as one product. */
function StageFrame({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full flex-col overflow-hidden rounded-sharp border border-line bg-surface", className)}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-muted/60 px-3 py-2">
        <span className="font-mono text-[11px] text-ink-subtle">{label}</span>
      </div>
      <div className="min-h-0">{children}</div>
    </div>
  );
}

/**
 * Text that types itself. The span holds its full width from the start so
 * nothing reflows, and the player reveals it by animating a clip in whole
 * character steps. The caret rides along in `ch` units.
 */
function Typed({ id, value, snapshot, className }: { id: string; value: string; snapshot?: boolean; className?: string }) {
  return (
    <span className="relative inline-flex min-w-0 font-mono text-[11.5px] whitespace-pre">
      <span
        data-anim={id}
        className={cn("whitespace-pre text-ink", className)}
        style={snapshot ? undefined : { clipPath: "inset(0 100% 0 0)" }}
      >
        {value}
      </span>
      {snapshot ? null : (
        <span
          data-anim={`${id}-caret`}
          aria-hidden
          className="absolute top-0 left-0 h-full w-px bg-heat-ink"
          style={{ opacity: 0 }}
        />
      )}
    </span>
  );
}

/** A click target the pointer aims at, with a flash the press cue pulses. */
function Target({
  name,
  children,
  className,
  snapshot,
}: {
  name: string;
  children: React.ReactNode;
  className?: string;
  snapshot?: boolean;
}) {
  return (
    <span data-target={name} className={cn("relative", className)}>
      {children}
      {snapshot ? null : (
        <span
          data-flash={name}
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-sharp ring-2 ring-heat"
          style={{ opacity: 0 }}
        />
      )}
    </span>
  );
}

const ENV_ROWS = [
  { name: "GEMINI_API_KEYS", id: "env-keys", value: "AQ.Ab8RN6EXAMPLE01,AQ.Ab8RN6EXAMPLE02" },
  { name: "GATEWAY_API_KEYS", id: "env-token", value: "gw_live_EXAMPLE_7f3c91" },
];

export function EnvStage({ snapshot }: StageProps) {
  return (
    <StageFrame label="your deployment / environment variables">
      <div className="flex flex-col gap-4 p-3 sm:p-4">
        <div className="space-y-2.5">
          {ENV_ROWS.map((row) => (
            <div key={row.id} className="space-y-1">
              <p className="font-mono text-[10.5px] tracking-wide text-ink-subtle">{row.name}</p>
              <Target
                name={row.id}
                snapshot={snapshot}
                className="flex h-8 items-center overflow-hidden rounded-sharp border border-line-strong bg-canvas px-2"
              >
                <Typed id={`${row.id}-value`} value={row.value} snapshot={snapshot} />
              </Target>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p
            data-anim="env-receipt"
            className="font-mono text-[10.5px] leading-relaxed text-ink-muted"
            style={snapshot ? undefined : { opacity: 0 }}
          >
            2 variables saved. Redeploy to load them.
          </p>
          <Target name="env-save" snapshot={snapshot} className="shrink-0">
            <span className="inline-flex h-7 items-center rounded-sharp bg-ink px-2.5 text-[11.5px] font-medium text-canvas">Save</span>
          </Target>
        </div>
      </div>
    </StageFrame>
  );
}

const POOL_KEYS = [
  { label: "main", hint: "AQ.…E01", share: 0.27 },
  { label: "spare-1", hint: "AQ.…E02", share: 0.26, throttled: true },
  { label: "spare-2", hint: "AQ.…E03", share: 0.22 },
  { label: "spare-3", hint: "AQ.…E04", share: 0.26 },
  { label: "spare-4", hint: "AQ.…E05", share: 0.19 },
];

export function PoolStage({ snapshot }: StageProps) {
  return (
    <StageFrame label="your dashboard / key rotation">
      <div className="flex flex-col">
        <div className="relative">
          {/* The marker rides this gutter to show which key is answering now. */}
          {snapshot ? null : (
            <span
              data-anim="pool-marker"
              aria-hidden
              className="absolute top-0 left-0 z-10 flex h-9 w-2.5 items-center justify-center font-mono text-[9px] text-heat-ink"
              style={{ opacity: 0 }}
            >
              {"▶"}
            </span>
          )}

          <ul>
            {POOL_KEYS.map((key, index) => (
              <li
                key={key.label}
                data-row={index}
                className="relative flex h-9 items-center gap-2 border-b border-line pr-3 pl-3.5 sm:pl-4"
              >
                {key.throttled ? (
                  <span
                    data-anim={`pool-heat-${index + 1}`}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-heat-wash"
                    style={snapshot ? undefined : { opacity: 0 }}
                  />
                ) : null}

                <span className="relative z-1 w-16 shrink-0 truncate font-mono text-[11px] text-ink sm:w-20">{key.label}</span>
                <span className="relative z-1 hidden shrink-0 font-mono text-[10.5px] text-ink-subtle sm:inline">{key.hint}</span>

                <span className="relative z-1 h-1 min-w-0 flex-1 bg-line">
                  <span
                    data-anim={`pool-bar-${index + 1}`}
                    className="block h-full origin-left bg-ink-subtle"
                    style={{ transform: `scaleX(${snapshot ? key.share : 0})` }}
                  />
                </span>

                <span className="relative z-1 w-24 shrink-0 text-right font-mono text-[10.5px] sm:w-28">
                  {key.throttled ? (
                    <>
                      <span
                        data-anim={`pool-rest-${index + 1}`}
                        className="text-ink-subtle"
                        style={snapshot ? { opacity: 0, position: "absolute", right: 0 } : undefined}
                      >
                        ready
                      </span>
                      <span
                        data-anim={`pool-hot-${index + 1}`}
                        className="text-heat-ink"
                        style={snapshot ? undefined : { opacity: 0, position: "absolute", right: 0 }}
                      >
                        429 cooling 41s
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-subtle">ready</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p
          data-anim="pool-receipt"
          className="px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted sm:px-4"
          style={snapshot ? undefined : { opacity: 0 }}
        >
          1 key throttled. 0 failed requests reached your app.
        </p>
      </div>
    </StageFrame>
  );
}

const TERMINAL_LINES = [
  { id: "term-1", text: "$ node chat.js", tone: "muted" as const },
  { id: "term-2", text: "200 OK in 412 ms", tone: "ink" as const },
  // A real response header. Two attempts means one key was throttled and the
  // next one answered, without the application seeing the failure.
  { id: "term-3", text: "x-juggle-attempts: 2", tone: "heat" as const },
];

export function CodeStage({ snapshot }: StageProps) {
  return (
    <StageFrame label="your app / chat.js">
      <div className="flex flex-col">
        <pre className="overflow-x-auto px-3 py-3 font-mono text-[11.5px] leading-[1.7] sm:px-4">
          <code>
            <span className="text-ink-subtle">import</span>
            <span className="text-ink"> OpenAI </span>
            <span className="text-ink-subtle">from</span>
            <span className="text-ink"> {'"openai"'};{"\n\n"}</span>
            <span className="text-ink-subtle">const</span>
            <span className="text-ink"> client = </span>
            <span className="text-ink-subtle">new</span>
            <span className="text-ink"> OpenAI({"{"}{"\n"}  baseURL: </span>
            {/*
              The two values are stacked in one grid cell rather than laid out
              side by side. Fading the old one out then leaves no gap, and the
              cell keeps the width of the longer string, so nothing reflows while
              the new URL types itself in. Each carries its own quotes for the
              same reason.
            */}
            <Target name="code-baseurl" snapshot={snapshot} className="inline-grid align-bottom">
              {snapshot ? null : (
                <span data-anim="code-url-old" className="col-start-1 row-start-1 text-ink-muted">
                  {'"https://api.openai.com/v1",'}
                </span>
              )}
              <span className="col-start-1 row-start-1">
                <Typed id="code-url-new" value={'"https://your-app.vercel.app/v1",'} snapshot={snapshot} className="text-heat-ink" />
              </span>
              {snapshot ? null : (
                <span
                  data-anim="code-selection"
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -inset-x-0.5 bg-heat-wash"
                  style={{ opacity: 0 }}
                />
              )}
            </Target>
            <span className="text-ink">{"\n"}  apiKey: process.env.JUGGLE_KEY,{"\n"}{"}"});</span>
          </code>
        </pre>

        <div className="border-t border-line bg-surface-muted/50">
          <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
            <div className="min-w-0 space-y-0.5">
              {TERMINAL_LINES.map((line) => (
                <p
                  key={line.id}
                  data-anim={line.id}
                  className={cn(
                    "truncate font-mono text-[10.5px]",
                    line.tone === "heat" ? "text-heat-ink" : line.tone === "ink" ? "text-ink" : "text-ink-subtle",
                  )}
                  style={snapshot ? undefined : { opacity: 0 }}
                >
                  {line.text}
                </p>
              ))}
            </div>
            <Target name="code-run" snapshot={snapshot} className="shrink-0">
              <span className="inline-flex h-7 items-center rounded-sharp border border-line-strong bg-surface px-2.5 font-mono text-[11px] text-ink">
                run
              </span>
            </Target>
          </div>
        </div>
      </div>
    </StageFrame>
  );
}

export const STAGES = [
  { id: "stage-env", Component: EnvStage },
  { id: "stage-pool", Component: PoolStage },
  { id: "stage-code", Component: CodeStage },
] as const;
