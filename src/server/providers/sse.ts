/**
 * Server-Sent Events parsing and encoding.
 *
 * Only the `data:` field matters for the provider APIs we speak, but the parser
 * follows the framing rules properly: events end at a blank line, multiple data
 * lines join with newlines, and comments (`:`) are ignored.
 */

const DECODER = new TextDecoder();

/** Splits an SSE byte stream into the payload of each event's `data:` field. */
export function parseSseStream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const reader = body.getReader();
  let buffer = "";

  const flushEvent = (raw: string, controller: ReadableStreamDefaultController<string>) => {
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue; // comment / keep-alive
      if (!line.startsWith("data:")) continue;
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length) controller.enqueue(dataLines.join("\n"));
  };

  return new ReadableStream<string>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) flushEvent(buffer, controller);
        controller.close();
        return;
      }
      buffer += DECODER.decode(value, { stream: true });
      // Events are separated by a blank line; tolerate CRLF.
      buffer = buffer.replace(/\r\n/g, "\n");
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        flushEvent(buffer.slice(0, separator), controller);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

/** Formats one SSE `data:` event. */
export function sseEvent(payload: unknown): string {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";
