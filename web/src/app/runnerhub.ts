// Crowd Run between runs: the run counter, the coin purse, and the three upgrades.
import { RunnerEconomy, Upgrade } from "../sim/runner/economy";
import * as art from "./art";
import * as audio from "./audio";
import { button, h, iconButton } from "./dom";
import { store } from "./store";

export interface RunnerHubOptions {
  onBack: () => void;
  onRun: () => void;
}

/// The coin purse: the painted coin and the count beside it.
const coinCount = (coins: number) => {
  const coin = h("div");
  art.paint(coin, "coin_gold", 26);
  return h("div.row", { style: { gap: "6px" }, role: "img", "aria-label": `${coins} coins` },
    coin, h("span.marker", { style: { fontSize: "20px" } }, String(coins)));
};

/// One upgrade: what it is, where it stands, what the next level buys, and the button that buys it.
const upgradeRow = (upgrade: Upgrade, level: number, coins: number, buy: () => void) => {
  const maxed = level >= Upgrade.maxLevel(upgrade), cost = Upgrade.cost(upgrade, level);
  const affordable = !maxed && coins >= cost;
  const preview = Upgrade.previewText(upgrade, level);
  const price = h<"button">("button.buy", {
    disabled: !affordable,
    "aria-label": maxed ? `${Upgrade.title(upgrade)}, at the maximum` : `Buy ${Upgrade.title(upgrade)} for ${cost} coins`,
    onclick: () => { audio.play("purchase"); buy(); },
  });
  if (!maxed) {
    const coin = h("div");
    art.paint(coin, "coin_gold", 18);
    price.append(coin);
  }
  price.append(maxed ? "MAX" : String(cost));
  return art.frame(h("div.upgrade",
    h("div.grow",
      h("div.name", Upgrade.title(upgrade)),
      h("div.level.mono.muted", `Lv ${level}/${Upgrade.maxLevel(upgrade)}   ${Upgrade.effectText(upgrade, level)}`),
      preview && h("div.preview", preview)),
    art.frame(price, affordable ? "ui_button_clay" : "ui_button_paper")));
};

/// Fill `host` with the hub. A purchase fills it again, so every row shows the new purse.
export const showRunnerHub = (host: HTMLElement, opts: RunnerHubOptions) => {
  const runner = store.progress.runner;
  const economy = new RunnerEconomy(runner.upgrades);
  const buy = (upgrade: Upgrade) => {
    const current = economy.level(upgrade), cost = Upgrade.cost(upgrade, current);
    if (current >= Upgrade.maxLevel(upgrade) || runner.coins < cost) return;
    store.update((p) => {
      p.runner.coins -= cost;
      p.runner.upgrades[upgrade] = current + 1;
    });
    audio.haptic("tap");
    showRunnerHub(host, opts);
  };
  // The clip's top third is headroom for emotes this clip does not use.
  const figure = art.clip("clawd_determined", 150);
  figure.style.margin = "-40px 0 -16px";
  host.replaceChildren(
    h("div.row.hub-top", iconButton("arrowBack", "Back", opts.onBack),
      h("div.grow", h("div.marker", { style: { fontSize: "26px", lineHeight: "1.1" } }, "CROWD RUN"),
        h("div.sub.mono.muted", `run ${runner.level + 1}   best ${runner.bestLevel}`)),
      coinCount(runner.coins)),
    art.frame(h("div.hub-card", figure,
      h("p.muted", "Drag to steer. Green gates grow the crowd, red ones shrink it. Whatever is left fights at the end."),
      button(`RUN ${runner.level + 1}`, opts.onRun, { filled: true }))),
    h("div.marker.muted", { style: { fontSize: "15px", marginTop: "4px" } }, "UPGRADES"),
    ...Upgrade.allCases.map((u) => upgradeRow(u, economy.level(u), runner.coins, () => buy(u))),
  );
};
