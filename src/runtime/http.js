"use strict";
function endpoint(value) {
  const url = new URL(value);
  if (url.username || url.password)
    throw new Error("Put credentials in secure storage, not in the URL.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS, or HTTP on localhost for a local service.");
  if (url.search || url.hash)
    throw new Error("Endpoint must not contain a query or fragment.");
  return url.toString().replace(/\/$/, "");
}
async function request(url, options = {}, signal, stopWhen) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error("Cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 120000);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
    let text = "";
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 2000000) {
          await reader.cancel();
          throw new Error("Response exceeds 2 MB");
        }
        text += decoder.decode(part.value, { stream: true });
        if (stopWhen?.(text)) {
          await reader.cancel();
          break;
        }
      }
      text += decoder.decode();
    }
    // Never echo provider bodies: they may contain request credentials or account data.
    if (!response.ok)
      throw new Error(
        `Service returned HTTP ${response.status}. Check credentials, model, endpoint and provider quota.`,
      );
    return { text, headers: response.headers };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
module.exports = { endpoint, request };
