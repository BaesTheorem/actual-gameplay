// A small helper for building the menus: h("div.card", {onclick}, child, "text").
import * as art from "./art";
import * as audio from "./audio";

type Child = Node | string | null | undefined | false;
type Props = Partial<Record<string, unknown>>;

export const h = <K extends keyof HTMLElementTagNameMap = "div">(spec: string, props: Props | Child = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const [tag, ...classes] = spec.split(".");
  const el = document.createElement(tag || "div") as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(" ");
  if (props instanceof Node || typeof props === "string" || !props) children.unshift(props as Child);
  else {
    for (const [key, value] of Object.entries(props)) {
      if (key === "style") Object.assign(el.style, value);
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value as EventListener);
      else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) if (child) el.append(child);
  return el;
};

/// Material Symbols glyphs by name, drawn from the codepoint so no ligature lookup is involved.
const GLYPHS: Record<string, number> = {
  arrowBack: 0xe5c4, refresh: 0xe5d5, settings: 0xe8b8, lock: 0xe899, close: 0xe5cd, chevronRight: 0xe5cc,
  shield: 0xe9e0, waterDrop: 0xe798, directionsRun: 0xe566, paid: 0xf041, group: 0xea21, bolt: 0xea0b,
  trendingUp: 0xe8e5, playArrow: 0xe037, add: 0xe145, emojiEvents: 0xea23,
};
export const icon = (name: string, size = 24) =>
  h("span.icon", { style: { fontSize: `${size}px`, width: `${size}px`, height: `${size}px` }, "aria-hidden": "true" }, String.fromCodePoint(GLYPHS[name] ?? 0xe88e));

/// A painted button: clay when filled, paper when not. A press plays the UI tap.
export const button = (label: string, action: () => void, opts: { filled?: boolean; art?: string; sound?: string } = {}) =>
  art.frame(h<"button">(`button.btn${opts.filled ? ".filled" : ""}`, {
    onclick: () => { audio.play(opts.sound ?? "tap"); action(); },
  }, label), opts.art ?? (opts.filled ? "ui_button_clay" : "ui_button_paper"));

export const iconButton = (name: string, label: string, action: () => void) =>
  art.frame(h<"button">("button.icon-btn", { "aria-label": label, onclick: () => { audio.play("tap"); action(); } }, icon(name)), "ui_button_paper");

export const stars = (count: number, size = 34) => {
  const row = h("div.stars", { role: "img", "aria-label": `${count} of 3 stars`, style: { gap: `${Math.max(2, size * 0.2)}px` } });
  for (let i = 0; i < 3; i++) {
    const star = h("div");
    art.paint(star, i < count ? "ui_star_on" : "ui_star_off", size);
    row.append(star);
  }
  return row;
};

/// A painted Clawd frame standing on a coloured painted swatch, for the mode cards.
export const swatch = (clipName: string, frameIndex: number, artName: string, size: number) => {
  const box = art.frame(h("div.swatch", { style: { width: `${size}px`, height: `${size}px` } }), artName, 14);
  // The clip frames leave room above Clawd for hats and emotes; the swatch only has to hold him.
  const clawd = h("div.clawd");
  art.paint(clawd, clipName, size * 0.95 * 360 / 320, frameIndex);
  clawd.style.transform = `translate(-50%, ${size * 0.03}px)`;
  box.append(clawd);
  return box;
};
