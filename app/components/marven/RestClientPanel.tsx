"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { RestRequest, RestMethod, RestHeader } from "@/types";
import { loadRestRequest, saveRestRequest } from "@/lib/restStorage";

const REST_METHODS: RestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<RestMethod, string> = {
  GET: "text-emerald-400",
  POST: "text-blue-400",
  PUT: "text-amber-400",
  PATCH: "text-purple-400",
  DELETE: "text-red-400",
  HEAD: "text-[var(--m-text-faint)]",
  OPTIONS: "text-[var(--m-text-faint)]",
};

interface RestResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-400";
  if (status >= 300 && status < 400) return "text-blue-400";
  if (status >= 400 && status < 500) return "text-amber-400";
  return "text-red-400";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface Props {
  requestId: string;
  workspaceRoot: string | null;
}

export function RestClientPanel({ requestId }: Props) {
  const [request, setRequest] = useState<RestRequest>(() => {
    const saved = loadRestRequest(requestId);
    return saved ?? {
      id: requestId,
      name: "New Request",
      method: "GET",
      url: "",
      headers: [{ key: "Content-Type", value: "application/json", enabled: false }],
      body: "",
      bodyType: "none",
    };
  });
  const [response, setResponse] = useState<RestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestTab, setRequestTab] = useState<"headers" | "body">("headers");
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-save on change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSave = useCallback((req: RestRequest) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveRestRequest(req);
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function updateRequest(patch: Partial<RestRequest>) {
    setRequest((prev) => {
      const next = { ...prev, ...patch };
      scheduleAutoSave(next);
      return next;
    });
  }

  // Header operations
  function updateHeader(index: number, patch: Partial<RestHeader>) {
    setRequest((prev) => {
      const next = {
        ...prev,
        headers: prev.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)),
      };
      scheduleAutoSave(next);
      return next;
    });
  }

  function addHeader() {
    setRequest((prev) => {
      const next = {
        ...prev,
        headers: [...prev.headers, { key: "", value: "", enabled: true }],
      };
      scheduleAutoSave(next);
      return next;
    });
  }

  function removeHeader(index: number) {
    setRequest((prev) => {
      const next = { ...prev, headers: prev.headers.filter((_, i) => i !== index) };
      scheduleAutoSave(next);
      return next;
    });
  }

  async function sendRequest() {
    if (!request.url.trim()) {
      setError("Enter a URL first.");
      return;
    }
    setError(null);
    setLoading(true);

    let url = request.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    const headers: Record<string, string> = {};
    for (const h of request.headers) {
      if (h.enabled && h.key.trim()) {
        headers[h.key.trim()] = h.value;
      }
    }

    const hasBody =
      request.bodyType !== "none" &&
      !["GET", "HEAD"].includes(request.method) &&
      request.body.trim();

    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
      });

      const durationMs = Date.now() - start;
      const rawBody = await res.text();

      // Collect response headers
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      // Try to pretty-print JSON
      let formattedBody = rawBody;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("json")) {
        try {
          formattedBody = JSON.stringify(JSON.parse(rawBody), null, 2);
        } catch {
          // keep raw
        }
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: formattedBody,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      setResponse({
        status: 0,
        statusText: "Network Error",
        headers: {},
        body: msg,
        durationMs,
      });
    } finally {
      setLoading(false);
    }
  }

  const enabledHeaderCount = request.headers.filter((h) => h.enabled && h.key.trim()).length;

  return (
    <div className="flex h-full flex-col bg-[var(--m-bg)] font-mono text-[12px]">
      {/* Request name */}
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-1.5">
        {editingName ? (
          <input
            ref={nameInputRef}
            autoFocus
            value={request.name}
            onChange={(e) => updateRequest({ name: e.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditingName(false);
            }}
            className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-0.5 text-[11px] text-[var(--m-text)] outline-none focus:border-[#d19a66]/60"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingName(true);
              requestAnimationFrame(() => nameInputRef.current?.select());
            }}
            className="rounded px-1 py-0.5 text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text)] hover:bg-[var(--m-surface-2)]"
            title="Click to rename"
          >
            {request.name}
          </button>
        )}
      </div>

      {/* Request line: Method + URL + Send */}
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-2">
        <select
          value={request.method}
          onChange={(e) => updateRequest({ method: e.target.value as RestMethod })}
          className={`rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[11px] font-bold outline-none focus:border-[#d19a66]/60 ${METHOD_COLORS[request.method]}`}
        >
          {REST_METHODS.map((m) => (
            <option key={m} value={m} className={METHOD_COLORS[m]}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={request.url}
          onChange={(e) => updateRequest({ url: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") sendRequest(); }}
          placeholder="https://api.example.com/endpoint"
          spellCheck={false}
          className="flex-1 rounded border border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-1 text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[#d19a66]/60"
        />

        <button
          type="button"
          onClick={sendRequest}
          disabled={loading}
          className="rounded border border-[#d19a66]/40 bg-[#d19a66]/10 px-3 py-1 text-[11px] font-medium text-[#d19a66] transition-colors hover:bg-[#d19a66]/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "..." : "Send"}
        </button>
      </div>

      {/* Request config tabs */}
      <div className="flex items-center border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3">
        <button
          type="button"
          onClick={() => setRequestTab("headers")}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
            requestTab === "headers"
              ? "border-b-2 border-[#d19a66] text-[var(--m-text)]"
              : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
          }`}
        >
          Headers {enabledHeaderCount > 0 && `(${enabledHeaderCount})`}
        </button>
        <button
          type="button"
          onClick={() => setRequestTab("body")}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
            requestTab === "body"
              ? "border-b-2 border-[#d19a66] text-[var(--m-text)]"
              : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
          }`}
        >
          Body
        </button>
      </div>

      {/* Request config area */}
      <div className="border-b border-[var(--m-border)] bg-[var(--m-surface)]" style={{ minHeight: 140, maxHeight: 200 }}>
        {requestTab === "headers" ? (
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--m-border-subtle)]">
                  <th className="w-8 px-2 py-1 text-left text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]" />
                  <th className="px-2 py-1 text-left text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]">Key</th>
                  <th className="px-2 py-1 text-left text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]">Value</th>
                  <th className="w-6 px-1 py-1" />
                </tr>
              </thead>
              <tbody>
                {request.headers.map((header, i) => (
                  <tr key={i} className="border-b border-[var(--m-border-subtle)]/50 hover:bg-[var(--m-surface-2)]/50">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={header.enabled}
                        onChange={(e) => updateHeader(i, { enabled: e.target.checked })}
                        className="accent-[#d19a66]"
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <input
                        type="text"
                        value={header.key}
                        onChange={(e) => updateHeader(i, { key: e.target.value })}
                        placeholder="Header-Name"
                        spellCheck={false}
                        className={`w-full bg-transparent px-1 py-0.5 text-[11px] outline-none placeholder:text-[var(--m-text-faint)] focus:bg-[var(--m-bg)] focus:rounded ${
                          header.enabled ? "text-[var(--m-text)]" : "text-[var(--m-text-faint)] line-through"
                        }`}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <input
                        type="text"
                        value={header.value}
                        onChange={(e) => updateHeader(i, { value: e.target.value })}
                        placeholder="value"
                        spellCheck={false}
                        className={`w-full bg-transparent px-1 py-0.5 text-[11px] outline-none placeholder:text-[var(--m-text-faint)] focus:bg-[var(--m-bg)] focus:rounded ${
                          header.enabled ? "text-[var(--m-text-muted)]" : "text-[var(--m-text-faint)] line-through"
                        }`}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <button
                        type="button"
                        onClick={() => removeHeader(i)}
                        className="rounded p-0.5 text-[var(--m-text-faint)] hover:text-red-400 hover:bg-red-400/10"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={addHeader}
              className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)]"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add header
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3" style={{ maxHeight: 200 }}>
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">Type</label>
              <select
                value={request.bodyType}
                onChange={(e) => updateRequest({ bodyType: e.target.value as RestRequest["bodyType"] })}
                className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-0.5 text-[11px] text-[var(--m-text-muted)] outline-none focus:border-[#d19a66]/60"
              >
                <option value="none">None</option>
                <option value="json">JSON</option>
                <option value="text">Text</option>
                <option value="form">Form</option>
              </select>
            </div>
            {request.bodyType !== "none" && (
              <textarea
                value={request.body}
                onChange={(e) => updateRequest({ body: e.target.value })}
                placeholder={request.bodyType === "json" ? '{\n  "key": "value"\n}' : "Request body..."}
                spellCheck={false}
                className="flex-1 resize-none rounded border border-[var(--m-border)] bg-[var(--m-bg)] p-2 text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[#d19a66]/60"
                style={{ minHeight: 100 }}
              />
            )}
            {request.bodyType === "none" && (
              <p className="text-[11px] text-[var(--m-text-faint)]">Select a body type to add a request body.</p>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {/* Response area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {response ? (
          <>
            {/* Response status bar */}
            <div className="flex items-center gap-3 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-1.5">
              <span className={`font-bold ${response.status > 0 ? statusColor(response.status) : "text-red-400"}`}>
                {response.status > 0 ? `${response.status} ${response.statusText}` : response.statusText}
              </span>
              <span className="text-[10px] text-[var(--m-text-faint)]">{response.durationMs}ms</span>
              <span className="text-[10px] text-[var(--m-text-faint)]">
                {formatBytes(new TextEncoder().encode(response.body).length)}
              </span>

              {/* Response tabs */}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setResponseTab("body")}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded transition-colors ${
                    responseTab === "body"
                      ? "bg-[var(--m-surface-2)] text-[var(--m-text)]"
                      : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                  }`}
                >
                  Body
                </button>
                <button
                  type="button"
                  onClick={() => setResponseTab("headers")}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded transition-colors ${
                    responseTab === "headers"
                      ? "bg-[var(--m-surface-2)] text-[var(--m-text)]"
                      : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                  }`}
                >
                  Headers ({Object.keys(response.headers).length})
                </button>
              </div>
            </div>

            {/* Response body / headers */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {responseTab === "body" ? (
                <pre className="p-3 text-[11px] leading-relaxed text-[var(--m-text-muted)] whitespace-pre-wrap break-words">
                  {response.body || <span className="text-[var(--m-text-faint)]">(empty body)</span>}
                </pre>
              ) : (
                <table className="w-full">
                  <tbody>
                    {Object.entries(response.headers).map(([key, val]) => (
                      <tr key={key} className="border-b border-[var(--m-border-subtle)]/50 hover:bg-[var(--m-surface-2)]/50">
                        <td className="px-3 py-1 text-[10px] text-[var(--m-text-faint)] whitespace-nowrap">{key}</td>
                        <td className="px-3 py-1 text-[11px] text-[var(--m-text-muted)] break-all">{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-[var(--m-text-faint)]">
              {loading ? (
                <>
                  <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  <span className="text-[11px]">Sending request...</span>
                </>
              ) : (
                <>
                  <svg className="h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-[11px]">Enter a URL and press Send</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
