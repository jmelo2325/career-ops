import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

type ChatMode =
  | "general"
  | "ofertas"
  | "contacto"
  | "deep"
  | "training"
  | "project"
  | "apply";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const MODES: { value: ChatMode; label: string; hint: string }[] = [
  { value: "general", label: "General", hint: "Free-form career advice using your full profile context" },
  { value: "ofertas", label: "Compare Offers", hint: "Compare multiple evaluated offers side-by-side" },
  { value: "contacto", label: "LinkedIn Outreach", hint: "Generate targeted LinkedIn connection messages" },
  { value: "deep", label: "Company Research", hint: "Deep research on a company for interview prep" },
  { value: "training", label: "Evaluate Training", hint: "Evaluate whether a course or cert is worth taking" },
  { value: "project", label: "Evaluate Project", hint: "Score a portfolio project idea on 6 dimensions" },
  { value: "apply", label: "Application Helper", hint: "Generate answers for application form questions" },
];

function classNames(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

export function Chat() {
  const [mode, setMode] = useState<ChatMode>("general");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  function handleModeChange(newMode: ChatMode) {
    if (newMode === mode) return;
    if (messages.length > 0 && !window.confirm("Changing modes will clear the conversation. Continue?")) {
      return;
    }
    setMode(newMode);
    setMessages([]);
    setStreamingText("");
    setInput("");
  }

  function handleClear() {
    if (messages.length === 0) return;
    if (!window.confirm("Clear the conversation?")) return;
    setMessages([]);
    setStreamingText("");
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: nextId(), role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);
    setStreamingText("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiMessages = nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: apiMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === "text") {
              fullText += parsed.text;
              setStreamingText(fullText);
            } else if (parsed.type === "error") {
              fullText += `\n\n**Error:** ${parsed.error}`;
              setStreamingText(fullText);
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: fullText },
        ]);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        const partial = streamingText;
        if (partial) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "assistant", content: partial + "\n\n*(stopped)*" },
          ]);
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `**Error:** ${msg}` },
        ]);
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const currentModeHint = MODES.find((m) => m.value === mode)?.hint || "";
  const atLimit = messages.length >= 50;

  return (
    <section className="flex h-[calc(100vh-120px)] flex-col rounded-3xl bg-zinc-900/30 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-5 py-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Mode
          <select
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as ChatMode)}
            className="rounded-lg bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <span className="text-xs text-zinc-500">{currentModeHint}</span>
        <div className="ml-auto flex gap-2">
          {streaming && (
            <button
              onClick={handleStop}
              className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-rose-500/25"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleClear}
            disabled={messages.length === 0 && !streaming}
            className="rounded-lg bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-zinc-950/80 disabled:opacity-30"
          >
            Clear chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !streaming && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md text-center">
              <div className="text-sm font-medium text-zinc-300">
                career-ops chat
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {currentModeHint}. Your CV, profile, and career context are loaded automatically.
              </div>
              <div className="mt-4 grid gap-2 text-left">
                {mode === "general" && <Suggestion text='What roles am I best suited for right now?' />}
                {mode === "ofertas" && <Suggestion text='Compare offers #001 and #003 — which should I prioritize?' />}
                {mode === "contacto" && <Suggestion text='Write a LinkedIn message for the hiring manager at Anthropic for a Sales Enablement role' />}
                {mode === "deep" && <Suggestion text='Do a deep dive on Vericast — I have an interview coming up' />}
                {mode === "training" && <Suggestion text='Should I get the Salesforce Sales Cloud certification?' />}
                {mode === "project" && <Suggestion text='Evaluate a project idea: an AI-powered enablement content recommender' />}
                {mode === "apply" && <Suggestion text='Help me answer these application questions: [paste questions]' />}
              </div>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {streaming && streamingText && (
          <MessageBubble
            message={{ id: "streaming", role: "assistant", content: streamingText }}
            isStreaming
          />
        )}

        {streaming && !streamingText && (
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            Thinking...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800/60 px-5 py-3">
        {atLimit ? (
          <div className="flex items-center justify-between rounded-xl bg-zinc-950/40 px-4 py-3">
            <span className="text-xs text-zinc-400">Conversation limit reached (50 messages).</span>
            <button
              onClick={handleClear}
              className="rounded-lg bg-zinc-950/60 px-3 py-1.5 text-xs text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-zinc-950/80"
            >
              Start new conversation
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              rows={2}
              disabled={streaming}
              className="flex-1 resize-none rounded-xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] disabled:opacity-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={streaming || !input.trim()}
              className="self-end rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-zinc-950 hover:opacity-95 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const html = useMemo(() => {
    const raw = marked.parse(message.content || "");
    return DOMPurify.sanitize(String(raw));
  }, [message.content]);

  const isUser = message.role === "user";

  return (
    <div className={classNames("mt-3 flex", isUser && "justify-end")}>
      <div
        className={classNames(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-zinc-800/60 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
            : "bg-zinc-950/40 text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {isStreaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-cyan-400" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <span className="text-zinc-500">Try:</span> {text}
    </div>
  );
}
