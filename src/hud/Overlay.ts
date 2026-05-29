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

/** Spawn a small floating "+N" popup near the combo flash. Self-removes after
 *  the CSS animation completes. Cheap — just a transient DOM node. */
export function spawnDamagePopup(el: OverlayElements, text: string, color = "#ffffff") {
  const node = document.createElement("div");
  node.className = "hud-dmg-popup";
  node.textContent = text;
  node.style.color = color;
  el.root.appendChild(node);
  // Remove on animation end (fallback: timer matches CSS duration).
  const cleanup = () => node.remove();
  node.addEventListener("animationend", cleanup, { once: true });
  setTimeout(cleanup, 700);
}

/**
 * Spawn a big floating note letter at `from` (viewport coords) and animate it
 * to `to` over `durationMs`. Used on enemy kills: the pitch label detaches
 * from the dying mesh and drifts up to the bar on the timeline that was the
 * kill shot. Duration is capped at ~2 beats by the caller.
 */
export function spawnKillLetter(
  el: OverlayElements,
  text: string,
  color: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
) {
  const node = document.createElement("div");
  node.className = "hud-kill-letter";
  node.textContent = text;
  node.style.color = color;
  node.style.left = `${from.x}px`;
  node.style.top = `${from.y}px`;
  el.root.appendChild(node);
  // Force the browser to commit the `from` styles BEFORE attaching the
  // transition. Reading `offsetWidth` flushes pending style/layout — without
  // this flush the browser batches the from/to writes into a single update
  // and the element teleports (which is what the user saw: kill letters
  // "flying up from elsewhere and aren't visible"). rAF was not enough
  // because both writes still landed inside the same render frame.
  void node.offsetWidth;
  node.style.transition =
    `left ${durationMs}ms cubic-bezier(.3,.7,.4,1),` +
    `top ${durationMs}ms cubic-bezier(.3,.7,.4,1),` +
    `font-size ${durationMs}ms ease-out,` +
    `opacity ${durationMs}ms ease-in`;
  node.style.left = `${to.x}px`;
  node.style.top = `${to.y}px`;
  node.style.fontSize = "18px";
  node.style.opacity = "0";
  setTimeout(() => node.remove(), durationMs + 80);
}
