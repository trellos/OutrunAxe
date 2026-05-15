export interface OverlayElements {
  root: HTMLDivElement;
  status: HTMLDivElement;
  hpBar: HTMLDivElement;
  hpFill: HTMLDivElement;
  hpLabel: HTMLDivElement;
  keyInfo: HTMLDivElement;
  comboFlash: HTMLDivElement;
  enemyCount: HTMLDivElement;
}

export function createOverlay(parent: HTMLElement): OverlayElements {
  const root = document.createElement("div");
  root.className = "outrun-hud";
  root.innerHTML = `
    <div class="hud-top-left">
      <div class="hud-hp">
        <div class="hud-hp-label">HP</div>
        <div class="hud-hp-bar">
          <div class="hud-hp-fill"></div>
        </div>
      </div>
      <div class="hud-key"></div>
    </div>
    <div class="hud-top-center">
      <div class="hud-status"></div>
    </div>
    <div class="hud-top-right">
      <div class="hud-enemy-count"></div>
    </div>
    <div class="hud-combo-flash"></div>
  `;
  parent.appendChild(root);

  return {
    root,
    status: root.querySelector(".hud-status") as HTMLDivElement,
    hpBar: root.querySelector(".hud-hp-bar") as HTMLDivElement,
    hpFill: root.querySelector(".hud-hp-fill") as HTMLDivElement,
    hpLabel: root.querySelector(".hud-hp-label") as HTMLDivElement,
    keyInfo: root.querySelector(".hud-key") as HTMLDivElement,
    comboFlash: root.querySelector(".hud-combo-flash") as HTMLDivElement,
    enemyCount: root.querySelector(".hud-enemy-count") as HTMLDivElement,
  };
}

export function setHp(el: OverlayElements, hp: number, maxHp: number) {
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  el.hpFill.style.width = `${pct * 100}%`;
  el.hpFill.style.background = pct > 0.5
    ? "linear-gradient(90deg, #2bffd0, #c7ff2b)"
    : pct > 0.25
      ? "linear-gradient(90deg, #ffd02b, #ff7a2b)"
      : "linear-gradient(90deg, #ff5a6b, #ff2bd6)";
}

export function flashCombo(el: OverlayElements, text: string, color = "#ff2bd6") {
  el.comboFlash.textContent = text;
  el.comboFlash.style.color = color;
  el.comboFlash.classList.remove("flash-on");
  void el.comboFlash.offsetWidth;
  el.comboFlash.classList.add("flash-on");
}
