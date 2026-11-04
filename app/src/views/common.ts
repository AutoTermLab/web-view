// Small DOM helpers shared by the views.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Replace `root` with a message and a retry button. */
export function showError(root: HTMLElement, error: unknown, retry: () => void) {
  console.error(error);
  root.replaceChildren(el("div", { className: "message" },
    el("p", {}, `Could not load the data: ${error instanceof Error ? error.message : String(error)}`),
    el("button", { onclick: retry }, "Retry")));
}
