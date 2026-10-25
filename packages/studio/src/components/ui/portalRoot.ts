/**
 * Where Studio's popups portal to. A page that embeds Studio inside its own style scope marks a
 * `.hf-portal-root` there, so menus, dialogs and tooltips keep Studio's styles; otherwise the body.
 */
export function getPortalRoot(doc: Document = document): HTMLElement {
  return doc.querySelector<HTMLElement>(".hf-portal-root") ?? doc.body;
}

/** `getPortalRoot` for a Base UI portal's `container`: nothing to find while rendering on a server. */
export function getPortalContainer(): HTMLElement | undefined {
  return typeof document === "undefined" ? undefined : getPortalRoot();
}
