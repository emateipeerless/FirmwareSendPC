export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Unwrap API Gateway / Lambda proxy envelopes until we get the real payload. */
export function unwrapPayload(data) {
  let current = data;
  for (let i = 0; i < 5; i++) {
    if (current == null) return {};
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
        continue;
      } catch {
        return { message: current };
      }
    }
    if (typeof current !== "object") return {};

    // Lambda proxy style: { statusCode, body: "<json string or object>" }
    if ("body" in current && ("statusCode" in current || "headers" in current)) {
      const body = current.body;
      if (body == null || body === "") return {};
      current = typeof body === "string" ? body : body;
      continue;
    }
    break;
  }
  return typeof current === "object" && current ? current : {};
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let raw;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed (${res.status})`);
  }
  const data = unwrapPayload(raw);
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function listFiles({ listUrl, bucket, prefix }) {
  const res = await fetch(listUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_bucket: bucket,
      s3_prefix: prefix,
    }),
  });
  return parseJsonResponse(res);
}

export async function startSend({ sendUrl, bucket, key, topic }) {
  const res = await fetch(sendUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_bucket: bucket,
      s3_key: key,
      topic,
    }),
  });
  return parseJsonResponse(res);
}

export async function getJobStatus({ statusUrl, bucket, jobId }) {
  const res = await fetch(statusUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3_bucket: bucket,
      job_id: jobId,
    }),
  });
  return parseJsonResponse(res);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(job) {
  return String(job?.status || "").toLowerCase().trim();
}

/**
 * Start async send, then poll job status until completed/failed.
 * onProgress(job) is called on each poll.
 */
export async function sendFile({
  sendUrl,
  statusUrl,
  bucket,
  key,
  topic,
  onProgress,
  pollMs = 1500,
  maxWaitMs = 20 * 60 * 1000,
}) {
  const started = await startSend({ sendUrl, bucket, key, topic });
  const jobId = started.job_id;
  if (!jobId) {
    return started;
  }
  if (!statusUrl) {
    throw new Error("Set VITE_STATUS_URL in frontend/.env to poll job completion");
  }

  onProgress?.(started);

  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error("Timed out waiting for send job to finish");
    }
    await sleep(pollMs);
    const job = await getJobStatus({ statusUrl, bucket, jobId });
    onProgress?.(job);

    const status = normalizeStatus(job);
    if (status === "completed") {
      return job.result || job;
    }
    if (status === "failed") {
      throw new Error(job.error || job.message || "Send failed");
    }
  }
}
