/**
 * A tiny stand-in for `document`, enough for renderNote: createElement,
 * className / classList.add, textContent, append / appendChild.
 */
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.classList = { add: (...names) => (this.className = [this.className, ...names].filter(Boolean).join(" ")) };
  }
  append(...nodes) {
    this.children.push(...nodes.filter((n) => typeof n === "object"));
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  setAttribute() {}
  /** This element and every descendant whose class list contains `name`. */
  findByClass(name) {
    const mine = this.className.split(/\s+/).includes(name) ? [this] : [];
    return [...mine, ...this.children.flatMap((c) => c.findByClass(name))];
  }
}

export const fakeDocument = { createElement: (tag) => new FakeElement(tag) };
