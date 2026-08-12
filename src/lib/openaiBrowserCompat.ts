/**
 * Detect whether this browser can call api.openai.com from a web page (CORS).
 * OpenAI intermittently or by policy blocks browser origins; a failed preflight
 * surfaces as a network TypeError with no readable response.
 */

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

/** True when the browser can complete a CORS request to OpenAI (even a 401). */
export async function canCallOpenAiFromBrowser(): Promise<boolean> {
  if (cached !== null) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          method: "GET",
          headers: { Authorization: "Bearer sk-browser-cors-probe" },
          signal: controller.signal
        });
        // Any HTTP status means CORS allowed the response through.
        cached = res.status > 0;
      } finally {
        window.clearTimeout(timer);
      }
    } catch {
      cached = false;
    } finally {
      inflight = null;
    }
    return cached === true;
  })();

  return inflight;
}
