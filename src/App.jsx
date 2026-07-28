import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, listFiles, sendFile } from "./api";
import "./App.css";

const LIST_URL = import.meta.env.VITE_LIST_URL || "";
const SEND_URL = import.meta.env.VITE_SEND_URL || "";
const STATUS_URL = import.meta.env.VITE_STATUS_URL || "";
const S3_BUCKET = "peerless-connect-firmware";
const S3_PREFIX = "7-22-firmware/";

export default function App() {
  const [files, setFiles] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const logEndRef = useRef(null);

  const topicPreview = deviceId.trim()
    ? `PeerConn/${deviceId.trim()}/firmware`
    : "PeerConn/{deviceId}/firmware";

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const refresh = useCallback(async () => {
    setError(null);
    setStatus(null);
    setLogs([]);
    setLoading(true);
    try {
      if (!LIST_URL) {
        throw new Error("Set VITE_LIST_URL in frontend/.env");
      }
      const data = await listFiles({
        listUrl: LIST_URL,
        bucket: S3_BUCKET,
        prefix: S3_PREFIX,
      });
      setFiles(data.files || []);
      setSelectedKey(null);
      setStatus(`Loaded ${data.count ?? data.files?.length ?? 0} file(s)`);
    } catch (err) {
      setFiles([]);
      setSelectedKey(null);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onSend = async () => {
    if (!selectedKey) return;
    const id = deviceId.trim();
    if (!id) {
      setError("Enter a device ID before sending");
      return;
    }
    const topic = `PeerConn/${id}/firmware`;
    setError(null);
    setLogs([]);
    setStatus(`Starting send to ${topic}…`);
    setSending(true);
    try {
      if (!SEND_URL) {
        throw new Error("Set VITE_SEND_URL in frontend/.env");
      }
      const data = await sendFile({
        sendUrl: SEND_URL,
        statusUrl: STATUS_URL,
        bucket: S3_BUCKET,
        key: selectedKey,
        topic,
        onProgress: (job) => {
          if (Array.isArray(job.logs) && job.logs.length) {
            setLogs(job.logs);
          }
          const label =
            job.message ||
            (job.status ? `Status: ${job.status}` : "Waiting for worker…");
          setStatus(label);
        },
      });
      const done =
        data.message ||
        `Successfully published all chunks from ${data.s3_key} (${formatBytes(data.bytes)})`;
      setStatus(done);
      setLogs((prev) => (prev.includes(done) ? prev : [...prev, done]));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  const selected = files.find((f) => f.key === selectedKey);

  return (
    <div className="app">
      <header className="header">
        <p className="brand">Peerless Connect</p>
        <h1>Send firmware file</h1>
        <p className="subtitle">
          Files from{" "}
          <code>
            s3://{S3_BUCKET}/{S3_PREFIX}
          </code>
        </p>
      </header>

      <section className="controls">
        <label className="device-field">
          Device ID
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="125"
            spellCheck={false}
            disabled={sending}
          />
          <span className="topic-hint">
            Topic: <code>{topicPreview}</code>
          </span>
        </label>
        <button type="button" className="btn secondary" onClick={refresh} disabled={loading || sending}>
          {loading ? "Loading…" : "Refresh list"}
        </button>
      </section>

      <section className="file-panel" aria-label="S3 files">
        <div className="file-panel-head">
          <span>File</span>
          <span>Size</span>
        </div>
        {files.length === 0 ? (
          <p className="empty">
            {loading ? "Loading files…" : "No files found in this folder."}
          </p>
        ) : (
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.key}>
                <button
                  type="button"
                  className={`file-row${selectedKey === file.key ? " selected" : ""}`}
                  onClick={() => setSelectedKey(file.key)}
                  disabled={sending}
                >
                  <span className="file-name" title={file.key}>
                    {file.name || file.key}
                  </span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="actions">
        <div className="selection">
          {selected ? (
            <>
              Selected: <code>{selected.key}</code> ({formatBytes(selected.size)})
            </>
          ) : (
            <span className="muted">Select a file to send</span>
          )}
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={onSend}
          disabled={!selectedKey || !deviceId.trim() || sending}
        >
          {sending ? "Sending…" : "Send File"}
        </button>
      </section>

      {(sending || logs.length > 0) && (
        <section className="log-panel" aria-label="Send progress log">
          <div className="log-panel-head">Progress log</div>
          <pre className="log-lines">
            {logs.length === 0 ? "Waiting for worker logs…" : logs.join("\n")}
            <div ref={logEndRef} />
          </pre>
        </section>
      )}

      {status && <p className="banner ok">{status}</p>}
      {error && <p className="banner err">{error}</p>}
    </div>
  );
}
