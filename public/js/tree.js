// Pure helpers: social links, layout and rendering of the family tree.
// No Firebase imports here so this file can be unit-tested in Node.

export const SOCIAL_PLATFORMS = [
  { key: "facebook", label: "Facebook", base: "https://www.facebook.com/" },
  { key: "instagram", label: "Instagram", base: "https://www.instagram.com/" },
  { key: "x", label: "X / Twitter", base: "https://x.com/" },
  { key: "tiktok", label: "TikTok", base: "https://www.tiktok.com/@" },
  { key: "linkedin", label: "LinkedIn", base: "https://www.linkedin.com/in/" },
];

/**
 * Turn a handle ("@jane", "jane.doe") or full URL into a safe https link.
 * Returns null for empty or unsafe values.
 */
export function socialUrl(platformKey, value) {
  const v = (value || "").trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch {
      return null;
    }
  }
  const platform = SOCIAL_PLATFORMS.find((p) => p.key === platformKey);
  if (!platform) return null;
  const handle = v.replace(/^@+/, "");
  if (!/^[\w.\-]{1,100}$/.test(handle)) return null;
  return platform.base + encodeURIComponent(handle);
}

export function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Assign every person a generation (row) and an order inside that row.
 * people: [{ id, parentIds: [], spouseIds: [] }] (input order = creation order)
 * Returns { level: Map<id, number>, rows: string[][] }
 */
export function computeLayout(people) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const parentsOf = (p) => (p.parentIds || []).filter((id) => byId.has(id));
  const spousesOf = (p) => (p.spouseIds || []).filter((id) => byId.has(id));

  // 1. Generations: child is one below its lowest parent; spouses share a row.
  const level = new Map(people.map((p) => [p.id, 0]));
  for (let i = 0; i <= people.length; i++) {
    let changed = false;
    for (const p of people) {
      let l = level.get(p.id);
      for (const pid of parentsOf(p)) l = Math.max(l, level.get(pid) + 1);
      for (const sid of spousesOf(p)) l = Math.max(l, level.get(sid));
      if (l !== level.get(p.id)) {
        level.set(p.id, l);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 1b. Pull childless ancestors-in-law down: a person with no parents sits
  // just above their highest child, so in-laws line up with their families.
  const childrenOf = new Map(people.map((p) => [p.id, []]));
  for (const p of people) for (const pid of parentsOf(p)) childrenOf.get(pid).push(p.id);
  for (let i = 0; i <= people.length; i++) {
    let changed = false;
    for (const p of people) {
      if (parentsOf(p).length) continue;
      const kids = childrenOf.get(p.id);
      let target = level.get(p.id);
      if (kids.length) target = Math.max(target, Math.min(...kids.map((k) => level.get(k))) - 1);
      for (const sid of spousesOf(p)) target = Math.max(target, level.get(sid));
      if (target !== level.get(p.id)) {
        level.set(p.id, target);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 2. Order inside each row: barycenter of parents, spouses kept together.
  const maxLevel = Math.max(0, ...level.values());
  const rows = [];
  const position = new Map();
  const inputIndex = new Map(people.map((p, i) => [p.id, i]));

  for (let l = 0; l <= maxLevel; l++) {
    const ids = people.filter((p) => level.get(p.id) === l).map((p) => p.id);
    const inRow = new Set(ids);
    const seen = new Set();
    const clusters = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      // collect spouse cluster within this row
      const cluster = [];
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur) || !inRow.has(cur)) continue;
        seen.add(cur);
        cluster.push(cur);
        for (const s of spousesOf(byId.get(cur))) stack.push(s);
      }
      cluster.sort((a, b) => inputIndex.get(a) - inputIndex.get(b));
      // put members with placed parents first so lines stay short
      const keyOf = (pid) => {
        const ps = parentsOf(byId.get(pid)).filter((x) => position.has(x));
        return ps.length ? ps.reduce((s, x) => s + position.get(x), 0) / ps.length : null;
      };
      const keys = cluster.map(keyOf).filter((k) => k !== null);
      const key = keys.length
        ? keys.reduce((a, b) => a + b, 0) / keys.length
        : Number.MAX_SAFE_INTEGER / 2 + inputIndex.get(cluster[0]);
      cluster.sort((a, b) => (keyOf(a) === null) - (keyOf(b) === null));
      clusters.push({ key, cluster });
    }
    clusters.sort((a, b) => a.key - b.key);
    const row = clusters.flatMap((c) => c.cluster);
    row.forEach((id, i) => position.set(id, i));
    rows.push(row);
  }
  return { level, rows };
}

const CARD_W = 170;
const CARD_H = 92;
const GAP_X = 36;
const GAP_Y = 80;
const PAD = 30;

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * Render the tree into `container`.
 * opts: { highlightEmail, onSelect(person) }
 */
export function renderTree(container, people, opts = {}) {
  container.textContent = "";
  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No one in this tree yet.";
    container.appendChild(empty);
    return;
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const { rows } = computeLayout(people);
  const widest = Math.max(...rows.map((r) => r.length));
  const width = PAD * 2 + widest * CARD_W + (widest - 1) * GAP_X;
  const height = PAD * 2 + rows.length * CARD_H + (rows.length - 1) * GAP_Y;

  const pos = new Map();
  rows.forEach((row, r) => {
    const rowWidth = row.length * CARD_W + (row.length - 1) * GAP_X;
    const startX = (width - rowWidth) / 2;
    row.forEach((id, i) => {
      pos.set(id, { x: startX + i * (CARD_W + GAP_X), y: PAD + r * (CARD_H + GAP_Y) });
    });
  });

  const stage = document.createElement("div");
  stage.className = "tree-stage";
  stage.style.width = width + "px";
  stage.style.height = height + "px";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.classList.add("tree-lines");
  const line = (d, cls) => {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    svg.appendChild(path);
  };

  // spouse links
  const drawnSpouse = new Set();
  for (const p of people) {
    for (const sid of p.spouseIds || []) {
      if (!pos.has(sid)) continue;
      const k = [p.id, sid].sort().join("|");
      if (drawnSpouse.has(k)) continue;
      drawnSpouse.add(k);
      const a = pos.get(p.id);
      const b = pos.get(sid);
      const [l, r] = a.x < b.x ? [a, b] : [b, a];
      const y = l.y + CARD_H / 2;
      if (l.y === r.y) line(`M${l.x + CARD_W},${y} H${r.x}`, "spouse");
    }
  }

  // parent -> child links (from the midpoint of the parents)
  for (const p of people) {
    const parents = (p.parentIds || []).filter((id) => pos.has(id)).map((id) => pos.get(id));
    if (!parents.length) continue;
    const c = pos.get(p.id);
    const childX = c.x + CARD_W / 2;
    const xs = parents.map((q) => q.x + CARD_W / 2);
    const parentBottom = Math.max(...parents.map((q) => q.y)) + CARD_H;
    let startX = xs.reduce((a, b) => a + b, 0) / xs.length;
    let startY = parentBottom;
    if (parents.length === 2 && parents[0].y === parents[1].y) {
      // start at the middle of the spouse line
      startY = parents[0].y + CARD_H / 2;
    }
    const midY = c.y - GAP_Y / 2;
    line(`M${startX},${startY} V${midY} H${childX} V${c.y}`, "child");
  }
  stage.appendChild(svg);

  const me = opts.highlightEmail || "";
  for (const [id, { x, y }] of pos) {
    const person = byId.get(id);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "person-card";
    if (me && person.email && person.email === me) card.classList.add("is-me");
    card.style.left = x + "px";
    card.style.top = y + "px";
    card.style.width = CARD_W + "px";
    card.style.height = CARD_H + "px";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = initials(person.name);
    const info = document.createElement("span");
    info.className = "info";
    const name = document.createElement("strong");
    name.textContent = person.name;
    const sub = document.createElement("small");
    const socialCount = Object.values(person.socials || {}).filter(Boolean).length;
    sub.textContent = person.email || (socialCount ? `${socialCount} social link(s)` : "");
    info.append(name, sub);
    card.append(avatar, info);
    card.addEventListener("click", () => opts.onSelect && opts.onSelect(person));
    stage.appendChild(card);
  }
  container.appendChild(stage);
}
