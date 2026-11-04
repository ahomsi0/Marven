import { createElement, Fragment, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isolate, marked } from "./isolate";

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));

describe("isolate", () => {
  it("wraps each inserted value in a bdi and leaves the sentence alone", () => {
    const m = marked({ host: "", target: "" });
    const text = `Let Marven act on ${m.host} — ${m.target}?`;
    expect(html(isolate(text, { host: "example.com", target: "زر الإرسال" })))
      .toBe("Let Marven act on <bdi>example.com</bdi> — <bdi>زر الإرسال</bdi>?");
  });

  it("keeps markers working through a nested translation", () => {
    const m = marked({ target: "" });
    const outer = `Next: clicking “${m.target}”`;
    expect(html(isolate(outer, { target: "Buy" }))).toBe("Next: clicking “<bdi>Buy</bdi>”");
  });

  it("renders page text as text, never as markup", () => {
    const m = marked({ target: "" });
    expect(html(isolate(`x ${m.target}`, { target: "<b>hi</b>" }))).toBe("x <bdi>&lt;b&gt;hi&lt;/b&gt;</bdi>");
  });

  it("doesn't let page text forge a placeholder", () => {
    const m = marked({ host: "", target: "" });
    expect(html(isolate(m.target, { host: "a.com", target: "host" }))).toBe("<bdi>host</bdi>");
  });
});
