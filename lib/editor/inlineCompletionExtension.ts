// lib/editor/inlineCompletionExtension.ts — CodeMirror 6 ghost-text completion.
import {
  Compartment,
  Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  keymap,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import type { AIProvider, InlineCompletionResponse } from "@/types";

export interface InlineCompletionOptions {
  enabled: boolean;
  debounceMs?: number;
  provider: AIProvider;
  model: string;
  filePath: string;
  workspaceRoot?: string;
  onAccept?: (chars: number) => void;
  onDismiss?: () => void;
}

interface GhostState {
  /** The suggested text to insert. */
  completion: string | null;
  /** Offset in the document where the ghost begins (cursor position when fetched). */
  from: number;
  /** Monotonic request id; responses with an older id are discarded. */
  requestId: number;
}

const INITIAL_STATE: GhostState = { completion: null, from: 0, requestId: 0 };

const setGhost = StateEffect.define<GhostState>();
const clearGhost = StateEffect.define<void>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-inline-completion";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export const inlineCompletionCompartment = new Compartment();

export function inlineCompletionExtension(
  opts: InlineCompletionOptions,
): Extension {
  if (!opts.enabled) return [];

  const debounceMs = opts.debounceMs ?? 350;

  const ghostField = StateField.define<GhostState>({
    create: () => INITIAL_STATE,
    update(prev, tr) {
      let next = prev;
      for (const e of tr.effects) {
        if (e.is(setGhost)) next = e.value;
        else if (e.is(clearGhost)) next = { ...INITIAL_STATE, requestId: prev.requestId };
      }
      // Any document change without an explicit setGhost dismisses the ghost.
      if (tr.docChanged && !tr.effects.some((e) => e.is(setGhost))) {
        next = { ...INITIAL_STATE, requestId: prev.requestId };
      }
      return next;
    },
    provide: (f) =>
      EditorView.decorations.from(f, (state) => {
        if (!state.completion) return Decoration.none;
        return Decoration.set([
          Decoration.widget({
            widget: new GhostWidget(state.completion),
            side: 1,
          }).range(state.from),
        ]);
      }),
  });

  const view = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private controller: AbortController | null = null;
      private requestSeq = 0;

      constructor(private readonly cmView: EditorView) {}

      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        // Only act on doc changes by user (typing). Selection-only changes
        // shouldn't trigger but should not interrupt either.
        if (!u.docChanged) return;

        // Multi-cursor → no trigger.
        if (u.state.selection.ranges.length > 1) {
          this.cancel();
          return;
        }
        const sel = u.state.selection.main;
        if (!sel.empty) {
          this.cancel();
          return;
        }
        // Empty doc → don't trigger.
        if (u.state.doc.length === 0) {
          this.cancel();
          return;
        }

        // Cancel anything in-flight.
        this.cancel();

        const cursor = sel.head;
        this.timer = setTimeout(() => {
          this.fire(cursor).catch(() => {
            /* silent */
          });
        }, debounceMs);
      }

      private async fire(cursorAtRequest: number): Promise<void> {
        const id = ++this.requestSeq;
        const state = this.cmView.state;
        const doc = state.doc.toString();
        const prefix = doc.slice(0, cursorAtRequest);
        const suffix = doc.slice(cursorAtRequest);

        this.controller = new AbortController();
        let json: InlineCompletionResponse;
        try {
          const res = await fetch("/api/completion/inline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prefix,
              suffix,
              filePath: opts.filePath,
              languageId: "",
              provider: opts.provider,
              model: opts.model,
            }),
            signal: this.controller.signal,
          });
          if (!res.ok) return;
          json = (await res.json()) as InlineCompletionResponse;
        } catch {
          return;
        }

        // Post-response guards.
        if (id !== this.requestSeq) return; // superseded
        const cur = this.cmView.state.selection.main;
        if (!cur.empty) return;
        if (cur.head !== cursorAtRequest) return; // cursor moved
        const completion = (json.completion ?? "").replace(/\s+$/u, "");
        if (!completion) return;
        if (!completion.trim()) return; // whitespace-only
        // If completion equals suffix prefix (echo), drop.
        if (suffix.startsWith(completion)) return;

        this.cmView.dispatch({
          effects: setGhost.of({
            completion,
            from: cursorAtRequest,
            requestId: id,
          }),
        });
      }

      cancel() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        if (this.controller) {
          this.controller.abort();
          this.controller = null;
        }
      }

      destroy() {
        this.cancel();
      }
    },
  );

  const km = keymap.of([
    {
      key: "Tab",
      run: (cmView) => {
        const g = cmView.state.field(ghostField);
        if (!g.completion) return false;
        const text = g.completion;
        cmView.dispatch({
          changes: { from: g.from, insert: text },
          selection: { anchor: g.from + text.length },
          effects: clearGhost.of(),
        });
        opts.onAccept?.(text.length);
        return true;
      },
    },
    {
      key: "Escape",
      run: (cmView) => {
        const g = cmView.state.field(ghostField);
        if (!g.completion) return false;
        cmView.dispatch({ effects: clearGhost.of() });
        opts.onDismiss?.();
        return true;
      },
    },
  ]);

  return [ghostField, view, Prec.highest(km)];
}

// Test-only exports.
export const __test = {
  setGhost,
  clearGhost,
};
