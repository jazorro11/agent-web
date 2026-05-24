/** Log only when AGENT_DEBUG_LOGS=true. Zero overhead when disabled. */
export function agentDebug(...args: Parameters<typeof console.log>): void {
  if (process.env.AGENT_DEBUG_LOGS === "true") {
    console.log(...args);
  }
}
