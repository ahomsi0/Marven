// @vitest-environment jsdom
// electron/browser/agentDom.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNTRUSTED_PAGE_HEADER as MAIN_HEADER, agentInPage, cleanRead, cleanTarget, findSnippets, formatRead, script,
} from "./agentDom.js";
import { isWebUrl } from "./validate.js";
import { UNTRUSTED_PAGE_HEADER } from "@/lib/pageAttachment";

// Each op returns its own shape; the tests read the fields they expect.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inPage = agentInPage as (req: Record<string, unknown>) => any;

// jsdom has no layout: every element gets a 100×20 box unless data-rect says
// otherwise, and is laid out (has client rects) unless it has data-norects.
// Text is laid out in its parent's box unless the parent has
// data-unrendered-text (as for text a closed shadow root never shows).
type RangeWithRects = Range & { getClientRects?: () => DOMRect[] };
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const custom = this.getAttribute("data-rect");
    const [left, top, width, height] = custom ? custom.split(",").map(Number) : [10, 10, 100, 20];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.hasAttribute("data-norects") ? [] : [this.getBoundingClientRect()]) as unknown as DOMRectList;
  });
  (Range.prototype as RangeWithRects).getClientRects = function (this: Range) {
    const parent = this.startContainer.parentElement;
    if (!parent || parent.closest("[data-norects]") || parent.hasAttribute("data-unrendered-text")) return [];
    return [parent.getBoundingClientRect()];
  };
  delete (window as unknown as { __marvenAgentState?: unknown }).__marvenAgentState;
});

afterEach(() => {
  delete (Range.prototype as RangeWithRects).getClientRects;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.title = "";
});

const read = () => inPage({ op: "read", nav: 1, maxElements: 60 });

describe("agentInPage read", () => {
  it("numbers interactive elements with accessible names", () => {
    document.title = "Shop";
    document.body.innerHTML = `
      <h1>Welcome</h1>
      <a href="/cart">Cart</a>
      <label for="q">Search</label><input id="q" value="shoes">
      <button aria-label="Add to cart"><svg></svg></button>
      <div role="button" tabindex="0">More</div>`;
    const r = read();
    expect(r.title).toBe("Shop");
    expect(r.text).toContain("Welcome");
    expect(r.elements.map((e: { ref: number; role: string; name: string }) => [e.ref, e.role, e.name])).toEqual([
      [1, "link", "Cart"], [2, "textbox", "Search"], [3, "button", "Add to cart"], [4, "button", "More"],
    ]);
    expect(r.elements[1].value).toBe("shoes");
  });

  it("drops text and elements a person can't see", () => {
    document.body.innerHTML = `
      <p>Visible text</p>
      <p style="display:none">SECRET-1</p>
      <p style="visibility:hidden">SECRET-2</p>
      <p style="opacity:0">SECRET-3</p>
      <p style="font-size:0">SECRET-4</p>
      <p aria-hidden="true">SECRET-5</p>
      <p hidden>SECRET-6</p>
      <div style="background-color: rgb(255, 255, 255)"><p style="color: rgb(255, 255, 255)">SECRET-7</p></div>
      <p data-rect="-9999,10,100,20">SECRET-8</p>
      <div style="overflow:hidden" data-rect="10,10,0,0"><p>SECRET-9</p></div>
      <div style="display:none"><button>Hidden button</button></div>`;
    const r = read();
    expect(r.text).toContain("Visible text");
    for (let i = 1; i <= 9; i++) expect(r.text).not.toContain(`SECRET-${i}`);
    expect(r.elements).toHaveLength(0);
  });

  it("flags sensitive, file and submitting elements and hides password values", () => {
    document.body.innerHTML = `
      <form>
        <input name="email" value="a@b.c">
        <input type="password" name="pw" value="hunter2">
        <input autocomplete="cc-number" name="x">
        <label>CVV <input name="code"></label>
        <input type="file" name="doc">
        <button>Pay</button>
        <button type="button">Help</button>
      </form>`;
    const byName = Object.fromEntries(read().elements.map((e: Record<string, unknown>) => [e.name, e]));
    expect(byName["email"]).toMatchObject({ sensitive: false, editable: true, value: "a@b.c" });
    expect(byName["pw"]).toMatchObject({ role: "password", sensitive: true, value: "" });
    expect(byName["x"]).toMatchObject({ sensitive: true });
    expect(byName["CVV"]).toMatchObject({ sensitive: true });
    expect(byName["doc"]).toMatchObject({ file: true });
    expect(byName["Pay"]).toMatchObject({ submits: true });
    expect(byName["Help"]).toMatchObject({ submits: false });
  });

  it("drops transparent text, but not gradient text", () => {
    document.body.innerHTML = `
      <p>Visible text</p>
      <p style="color: transparent">SECRET-1</p>
      <p style="color: rgba(0, 0, 0, 0.05)">SECRET-2</p>
      <p style="-webkit-text-fill-color: transparent">SECRET-3</p>
      <h1 style="-webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent">Gradient heading</h1>`;
    const r = read();
    expect(r.text).toContain("Visible text");
    expect(r.text).toContain("Gradient heading");
    for (let i = 1; i <= 3; i++) expect(r.text).not.toContain(`SECRET-${i}`);
  });

  it("drops text and elements that aren't laid out or have no size", () => {
    document.body.innerHTML = `
      <p>Visible text</p>
      <div data-norects><p>SECRET-1</p><button>Hidden button</button></div>
      <div data-unrendered-text>SECRET-2<span data-norects>SECRET-3</span></div>
      <p data-rect="10,10,0,0">SECRET-4</p>
      <button data-rect="10,10,0,0">Shrunk button</button>
      <div style="display: contents">Contents text</div>
      <div style="content-visibility: hidden">SECRET-5</div>`;
    const r = read();
    expect(r.text).toContain("Visible text");
    expect(r.text).toContain("Contents text");
    for (let i = 1; i <= 5; i++) expect(r.text).not.toContain(`SECRET-${i}`);
    expect(r.elements).toHaveLength(0);
  });

  it("shows only the summary of a closed details element", () => {
    document.body.innerHTML = `
      <details><summary>More</summary>SECRET-1<p>SECRET-2</p><button>Inside</button></details>
      <details open><summary>Open</summary><p>Shown body</p><button>Open inside</button></details>`;
    const r = read();
    expect(r.text).toContain("More");
    expect(r.text).toContain("Shown body");
    expect(r.text).not.toMatch(/SECRET/);
    expect(r.elements.map((e: { name: string }) => e.name)).toEqual(["More", "Open", "Open inside"]);
  });

  it("drops text clipped to a pixel, only where clip applies", () => {
    document.body.innerHTML = `
      <p style="position: absolute; clip: rect(1px, 1px, 1px, 1px)">SECRET-1</p>
      <p style="position: absolute; clip: rect(0px, 0px, 0px, 0px)">SECRET-2</p>
      <p style="position: absolute; clip: rect(0px, 100px, 1px, 0px)">SECRET-3</p>
      <p style="clip: rect(0px, 0px, 0px, 0px)">Not positioned</p>
      <p style="position: absolute; clip: rect(0px, 100px, 20px, 0px)">Clipped to its size</p>`;
    const r = read();
    expect(r.text).toContain("Not positioned");
    expect(r.text).toContain("Clipped to its size");
    expect(r.text).not.toMatch(/SECRET/);
  });

  it("reads a shadow host's light DOM only where a slot shows it", () => {
    document.body.innerHTML = `<div id="plain">SECRET-1<span>SECRET-2</span></div><div id="slotted">Slotted text</div>`;
    document.getElementById("plain")!.attachShadow({ mode: "open" }).innerHTML = "<p>Shadow text</p>";
    document.getElementById("slotted")!.attachShadow({ mode: "open" }).innerHTML = "<p>Before</p><slot></slot><p>After</p>";
    const text = read().text;
    expect(text).toContain("Shadow text");
    expect(text).toMatch(/Before\s*Slotted text\s*After/);
    expect(text).not.toMatch(/SECRET/);
  });

  it("treats password fields shown as text, passcodes and labelled card fields as sensitive", () => {
    document.body.innerHTML = `
      <form>
        <input name="password" value="v1">
        <input name="passcode" value="v2">
        <span id="card-label">Card number</span><input aria-labelledby="card-label" value="v3">
        <input name="user_pwd" value="v4">
        <input name="pass" value="v5">
        <input name="passwd" value="v6">
        <input name="passenger" value="Ada">
      </form>`;
    expect(read().elements.map((e: Record<string, unknown>) => [e.name, e.sensitive, e.value])).toEqual([
      ["password", true, ""], ["passcode", true, ""], ["Card number", true, ""], ["user_pwd", true, ""],
      ["pass", true, ""], ["passwd", true, ""], ["passenger", false, "Ada"],
    ]);
  });

  it("treats a field masked with -webkit-text-security as sensitive", () => {
    document.body.innerHTML = `<input name="q" value="secret">`;
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const style = real(el);
      if (el.tagName !== "INPUT") return style;
      return new Proxy(style, { get: (target, key) => (key === "webkitTextSecurity" ? "disc" : Reflect.get(target, key)) });
    });
    expect(read().elements[0]).toMatchObject({ sensitive: true, value: "" });
  });

  it("puts elements in view first", () => {
    document.body.innerHTML = `<a href="/a" data-rect="10,2000,50,20">Far</a><a href="/b">Near</a>`;
    expect(read().elements.map((e: { name: string; inViewport: boolean }) => [e.name, e.inViewport])).toEqual([["Near", true], ["Far", false]]);
  });
});

describe("agentInPage targets", () => {
  it("returns the centre and whether something covers it", () => {
    document.body.innerHTML = `<button>Go</button><div id="overlay">Cookie banner</div>`;
    read();
    const button = document.querySelector("button")!;
    document.elementFromPoint = vi.fn(() => button);
    expect(inPage({ op: "target", nav: 1, ref: 1, scroll: false })).toMatchObject({ x: 60, y: 20, covered: "" });
    document.elementFromPoint = vi.fn(() => document.getElementById("overlay"));
    expect(inPage({ op: "target", nav: 1, ref: 1, scroll: false }).covered).toBe("Cookie banner");
  });

  it("refuses refs from another page or that are gone", () => {
    document.body.innerHTML = `<button>Go</button>`;
    read();
    expect(inPage({ op: "target", nav: 2, ref: 1 })).toEqual({ error: "stale" });
    expect(inPage({ op: "target", nav: 1, ref: 9 })).toEqual({ error: "unknown" });
    document.querySelector("button")!.remove();
    expect(inPage({ op: "target", nav: 1, ref: 1 })).toEqual({ error: "gone" });
  });

  it("lists a form's fields for a submit, with sensitive values hidden", () => {
    document.body.innerHTML = `<form><input name="email" value="a@b.c"><input type="password" name="pw" value="x"><button>Sign in</button></form>`;
    read();
    document.elementFromPoint = vi.fn(() => document.querySelector("button"));
    expect(inPage({ op: "target", nav: 1, ref: 3 }).fields).toEqual([
      { name: "email", value: "a@b.c" }, { name: "pw", value: "(hidden)" },
    ]);
  });

  it("focuses and selects a field, chooses options, finds focus", () => {
    document.body.innerHTML = `<form><input name="q" value="old"></form><select name="size"><option value="s">Small</option><option value="l">Large</option></select>`;
    read();
    expect(inPage({ op: "focus", nav: 1, ref: 1 })).toEqual({ ok: true });
    expect(inPage({ op: "focused" })).toMatchObject({ name: "q", entersSubmit: true, sensitive: false });
    const changed = vi.fn();
    document.querySelector("select")!.addEventListener("change", changed);
    expect(inPage({ op: "select", nav: 1, ref: 2, option: "large" })).toEqual({ selected: "Large" });
    expect(changed).toHaveBeenCalled();
    expect(inPage({ op: "select", nav: 1, ref: 2, option: "XL" })).toEqual({ error: "no-option", options: ["Small", "Large"] });
  });

  it("serializes with its request as a JSON literal", () => {
    document.body.innerHTML = `<p>Hello "world"</p>`;
    expect((0, eval)(script({ op: "hasText", text: 'hello "WORLD' }))).toEqual({ found: true });
  });
});

describe("main-side helpers", () => {
  it("keeps the untrusted header in sync with lib/pageAttachment.ts", () => {
    expect(MAIN_HEADER).toBe(UNTRUSTED_PAGE_HEADER);
  });

  it("cleanRead rejects non-web pages and caps fields", () => {
    expect(cleanRead({ url: "about:blank", text: "x" }, isWebUrl)).toBeNull();
    const r = cleanRead({ url: "https://a.test/", title: "T", text: "body", elements: [{ ref: 1, role: "link", name: "n".repeat(200) }] }, isWebUrl)!;
    expect(r.elements[0].name).toHaveLength(80);
  });

  it("cleanTarget maps unknown errors to gone", () => {
    expect(cleanTarget({ error: "weird" })).toEqual({ error: "gone" });
    expect(cleanTarget(null)).toEqual({ error: "gone" });
  });

  it("formats a read with continuation, quoting and the untrusted headers", () => {
    const text = "a".repeat(5000);
    const out = formatRead({
      url: "https://a.test/", title: "T", text, totalElements: 2, scrollY: 0, scrollHeight: 1800, viewportHeight: 800,
      elements: [{ ref: 1, role: "button", name: 'Say "hi"\nnow', value: "", checked: false, disabled: false, inViewport: true, editable: false, sensitive: false, file: false, submits: true }],
    }, { header: "[tab t1] T — https://a.test/", offset: 0, find: "" });
    expect(out).toContain(MAIN_HEADER);
    expect(out).toContain("Call browser_read with offset 4000 for more.");
    expect(out).toContain('[1] button "Say \\"hi\\"\\nnow" (submits a form)');
    expect(out).toContain("[1 more elements further down");
  });

  it("finds snippets around matches", () => {
    expect(findSnippets("one two three two", "TWO")).toHaveLength(1);
    expect(findSnippets("x".repeat(300) + "needle" + "y".repeat(300) + "needle", "needle")).toHaveLength(2);
    expect(findSnippets("abc", "")).toEqual([]);
  });
});
