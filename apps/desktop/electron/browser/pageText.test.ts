// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EXTRACT_SCRIPT, MAX_SELECTION, MAX_TEXT, cleanExtract, extractInPage } from "./pageText.js";
import { isWebUrl } from "./validate.js";

afterEach(() => {
  document.title = "";
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6);

describe("extractInPage", () => {
  it("prefers the main article and drops navigation, footers and scripts", () => {
    document.title = "My Post";
    document.body.innerHTML = `
      <nav>Home | About | Contact</nav>
      <article>
        <h1>Heading</h1>
        <p>First   paragraph.</p>
        <script>var secret = 1;</script>
        <style>.x{}</style>
        <p>${filler}</p>
        <footer>Article footer</footer>
      </article>
      <footer>Site footer</footer>`;
    const out = extractInPage();
    expect(out.title).toBe("My Post");
    expect(out.url).toBe(location.href);
    expect(out.text).toMatch(/^Heading\n{1,2}First paragraph\.\n/);
    expect(out.text).not.toMatch(/\n{3}/);
    expect(out.text).not.toMatch(/Home \| About|secret|\.x\{|footer/);
  });

  it("falls back to the body when there's no real article", () => {
    document.body.innerHTML = `<main>tiny</main><div>Body text<br>next line</div><nav>menu</nav>`;
    const out = extractInPage();
    expect(out.text).toContain("Body text\nnext line");
    expect(out.text).toContain("tiny");
    expect(out.text).not.toContain("menu");
  });

  it("caps long pages with a truncation note", () => {
    document.body.innerHTML = `<p>${"word ".repeat(10000)}</p>`;
    const out = extractInPage();
    expect(out.text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(out.text.endsWith("[truncated]")).toBe(true);
  });

  it("returns the selection, capped", () => {
    document.body.innerHTML = `<p id="p">${"s".repeat(MAX_SELECTION + 100)}</p>`;
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p")!);
    window.getSelection()!.addRange(range);
    expect(extractInPage().selection).toHaveLength(MAX_SELECTION);
  });

  it("serializes into a fixed, self-contained script", () => {
    document.body.innerHTML = `<p>Hello</p>`;
    expect(EXTRACT_SCRIPT.startsWith("(function extractInPage")).toBe(true);
    // eslint-disable-next-line no-eval
    expect((0, eval)(EXTRACT_SCRIPT).text).toBe("Hello");
  });
});

describe("cleanExtract", () => {
  it("keeps a valid page and trims fields", () => {
    expect(cleanExtract({ url: "https://a.com/", title: " A \n B ", selection: " sel ", text: " body " }, isWebUrl)).toEqual({
      url: "https://a.com/",
      title: "A B",
      selection: "sel",
      text: "body",
    });
  });

  it("rejects junk, non-web URLs and empty pages", () => {
    expect(cleanExtract(null, isWebUrl)).toBeNull();
    expect(cleanExtract("x", isWebUrl)).toBeNull();
    expect(cleanExtract({ url: "chrome://settings", text: "x" }, isWebUrl)).toBeNull();
    expect(cleanExtract({ url: "https://a.com/", text: "", selection: "" }, isWebUrl)).toBeNull();
  });

  it("re-applies the caps and coerces non-strings", () => {
    const out = cleanExtract({ url: "https://a.com/", title: 5, selection: "s".repeat(9000), text: "t".repeat(30000) }, isWebUrl);
    expect(out?.title).toBe("");
    expect(out?.selection).toHaveLength(MAX_SELECTION);
    expect(out?.text.length).toBe(MAX_TEXT);
    expect(out?.text.endsWith("[truncated]")).toBe(true);
  });
});
