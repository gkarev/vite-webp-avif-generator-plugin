/**
 * Vite `customLogger` that records plugin output for assertions.
 *
 * The plugin now logs through Vite's `logger`, which honors `logLevel`. Tests
 * that used `logLevel: "silent"` + `console` patching would capture nothing, so
 * they pass this recording logger via `customLogger` instead. `warnOnce` dedupes
 * identical messages to mirror Vite's real logger behavior.
 *
 * @param {{ echo?: boolean }} [options] - Set `echo` to also print to the console.
 */
export function createCaptureLogger({ echo = false } = {}) {
  const messages = [];
  const warnedOnce = new Set();

  const record = (msg) => {
    const text = String(msg);
    messages.push(text);
    if (echo) console.log(text);
  };

  const logger = {
    hasWarned: false,
    info: (msg) => record(msg),
    warn: (msg) => {
      logger.hasWarned = true;
      record(msg);
    },
    warnOnce: (msg) => {
      const text = String(msg);
      if (warnedOnce.has(text)) return;
      warnedOnce.add(text);
      logger.hasWarned = true;
      record(text);
    },
    error: (msg) => record(msg),
    clearScreen: () => {},
    hasErrorLogged: () => false
  };

  return {
    logger,
    messages,
    text: () => messages.join("\n"),
    count: (needle) => messages.filter((msg) => msg.includes(needle)).length
  };
}
