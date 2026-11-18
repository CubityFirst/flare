/**
 * Sanitises message HTML down to the small subset Pushover supports:
 * <b> <strong> <i> <em> <u> <br> <a href> <font color>.
 * Everything else is unwrapped to its text content.
 */
const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "A", "FONT"]);

export function sanitizeHtml(input: string): string {
  const doc = new DOMParser().parseFromString(`<div>${input}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;

  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        walk(el);
        if (!ALLOWED.has(el.tagName)) {
          el.replaceWith(...el.childNodes);
          continue;
        }
        for (const attr of [...el.attributes]) {
          const keep =
            (el.tagName === "A" && attr.name === "href" && /^(https?:|mailto:)/i.test(attr.value.trim())) ||
            (el.tagName === "FONT" && attr.name === "color" && /^#?[a-z0-9]{3,20}$/i.test(attr.value.trim()));
          if (!keep) el.removeAttribute(attr.name);
        }
        if (el.tagName === "A") {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  };
  walk(root);
  return root.innerHTML;
}
