const DRAFT_ORDER = [
  { side: "blue", type: "ban", num: 1 },
  { side: "red", type: "ban", num: 1 },
  { side: "blue", type: "ban", num: 2 },
  { side: "red", type: "ban", num: 2 },
  { side: "blue", type: "ban", num: 3 },
  { side: "red", type: "ban", num: 3 },
  { side: "blue", type: "pick", num: 1 },
  { side: "red", type: "pick", num: 1 },
  { side: "red", type: "pick", num: 2 },
  { side: "blue", type: "pick", num: 2 },
  { side: "blue", type: "pick", num: 3 },
  { side: "red", type: "pick", num: 3 },
  { side: "red", type: "ban", num: 4 },
  { side: "blue", type: "ban", num: 4 },
  { side: "red", type: "ban", num: 5 },
  { side: "blue", type: "ban", num: 5 },
  { side: "red", type: "pick", num: 4 },
  { side: "blue", type: "pick", num: 4 },
  { side: "blue", type: "pick", num: 5 },
  { side: "red", type: "pick", num: 5 }
];

const CHAMPION_DATA_PATHS = [
  "/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/data/en_US/champion.json",
  "/draft-sage/resources/champions.json"
];
const CHAMPION_IMG_BASE = "/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/img/champion/";

const DEFAULT_CONFIG = {
  mode: "interactive",
  userSide: "blue",
  apiBaseUrl: "http://localhost:8001",
  autoAdvance: true
};

const state = {
  champions: [],
  championMap: new Map(),
  activeIndex: 0,
  draftSlots: DRAFT_ORDER.map((slot) => ({ ...slot, champion: null, source: null })),
  mode: DEFAULT_CONFIG.mode,
  userSide: DEFAULT_CONFIG.userSide,
  apiBaseUrl: DEFAULT_CONFIG.apiBaseUrl,
  autoAdvance: DEFAULT_CONFIG.autoAdvance,
  searchQuery: "",
  isPicking: false,
  seriesGame: 1,
  fearlessLockout: new Set()
};

const elements = {
  modeToggle: document.getElementById("mode-toggle"),
  sideToggle: document.getElementById("side-toggle"),
  apiBase: document.getElementById("api-base"),
  apiStatus: document.getElementById("api-status"),
  championSource: document.getElementById("champion-source"),
  draftStatus: document.getElementById("draft-status"),
  autoAdvance: document.getElementById("auto-advance"),
  seriesGame: document.getElementById("series-game"),
  lockoutCount: document.getElementById("lockout-count"),
  commitGame: document.getElementById("commit-game"),
  resetSeries: document.getElementById("reset-series"),
  currentSlot: document.getElementById("current-slot"),
  aiPick: document.getElementById("ai-pick"),
  undoPick: document.getElementById("undo-pick"),
  resetDraft: document.getElementById("reset-draft"),
  timeline: document.getElementById("draft-timeline"),
  blueBansEarly: document.getElementById("blue-bans-early"),
  bluePicksEarly: document.getElementById("blue-picks-early"),
  blueBansLate: document.getElementById("blue-bans-late"),
  bluePicksLate: document.getElementById("blue-picks-late"),
  redBansEarly: document.getElementById("red-bans-early"),
  redPicksEarly: document.getElementById("red-picks-early"),
  redBansLate: document.getElementById("red-bans-late"),
  redPicksLate: document.getElementById("red-picks-late"),
  blueSummary: document.getElementById("blue-summary"),
  redSummary: document.getElementById("red-summary"),
  search: document.getElementById("search"),
  poolCount: document.getElementById("pool-count"),
  poolTotal: document.getElementById("pool-total"),
  championGrid: document.getElementById("champion-grid")
};

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function loadConfig() {
  const stored = window.localStorage.getItem("draft-sage-ui");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      state.mode = parsed.mode || state.mode;
      state.userSide = parsed.userSide || state.userSide;
      state.apiBaseUrl = parsed.apiBaseUrl || state.apiBaseUrl;
      state.autoAdvance = typeof parsed.autoAdvance === "boolean" ? parsed.autoAdvance : state.autoAdvance;
    } catch (error) {
      console.warn("Failed to load config", error);
    }
  }
}

function persistConfig() {
  window.localStorage.setItem(
    "draft-sage-ui",
    JSON.stringify({
      mode: state.mode,
      userSide: state.userSide,
      apiBaseUrl: state.apiBaseUrl,
      autoAdvance: state.autoAdvance
    })
  );
}

async function loadChampionData() {
  let lastError = null;
  for (const path of CHAMPION_DATA_PATHS) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const data = payload.data || {};
      const champions = Object.values(data).map((champion) => ({
        id: champion.id,
        name: champion.name,
        key: champion.key,
        image: champion.image?.full || null,
        tags: champion.tags || [],
        search: normalize(`${champion.name} ${champion.id}`)
      }));
      champions.sort((a, b) => a.name.localeCompare(b.name));
      state.champions = champions;
      state.championMap = new Map(champions.map((champ) => [normalize(champ.name), champ]));
      elements.championSource.textContent = path;
      elements.poolTotal.textContent = `${champions.length} total`;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Failed to load champion data", lastError);
  elements.championSource.textContent = "Missing champion data";
}

function initTimeline() {
  elements.timeline.innerHTML = "";
  state.draftSlots.forEach((slot, index) => {
    const card = document.createElement("div");
    card.className = `slot ${slot.side}`;
    card.dataset.index = String(index);

    const meta = document.createElement("div");
    meta.className = "slot-meta";
    meta.innerHTML = `<span>${slot.side.toUpperCase()}</span><span>${slot.type.toUpperCase()} ${slot.num}</span>`;

    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = "Open";

    card.appendChild(meta);
    card.appendChild(name);
    card.addEventListener("click", () => {
      state.activeIndex = index;
      render();
    });
    elements.timeline.appendChild(card);
  });
}

function getUnavailableSet() {
  const unavailable = new Set([...state.fearlessLockout]);
  state.draftSlots.forEach((slot) => {
    if (slot.champion) {
      unavailable.add(normalize(slot.champion.name));
    }
  });
  return unavailable;
}

function getCurrentSlot() {
  return state.draftSlots[state.activeIndex] || null;
}

function getNextOpenIndex(startIndex) {
  for (let i = startIndex; i < state.draftSlots.length; i += 1) {
    if (!state.draftSlots[i].champion) {
      return i;
    }
  }
  return null;
}

function setDraftStatus(message) {
  elements.draftStatus.textContent = message;
}

function setChampionAt(index, champion, source) {
  state.draftSlots[index].champion = champion;
  state.draftSlots[index].source = source;
  const nextIndex = getNextOpenIndex(index + 1);
  if (nextIndex !== null) {
    state.activeIndex = nextIndex;
  }
}

function clearSlot(index) {
  state.draftSlots[index].champion = null;
  state.draftSlots[index].source = null;
}

function undoLast() {
  for (let i = state.draftSlots.length - 1; i >= 0; i -= 1) {
    if (state.draftSlots[i].champion) {
      clearSlot(i);
      state.activeIndex = i;
      return true;
    }
  }
  return false;
}

function resetDraft() {
  state.draftSlots.forEach((slot) => {
    slot.champion = null;
    slot.source = null;
  });
  state.activeIndex = 0;
}

function commitGame() {
  state.draftSlots.forEach((slot) => {
    if (slot.type === "pick" && slot.champion) {
      state.fearlessLockout.add(normalize(slot.champion.name));
    }
  });
  state.seriesGame += 1;
  resetDraft();
}

function resetSeries() {
  state.fearlessLockout.clear();
  state.seriesGame = 1;
  resetDraft();
}

function getTeamSummary(side) {
  const picks = state.draftSlots.filter((slot) => slot.side === side && slot.type === "pick" && slot.champion);
  const bans = state.draftSlots.filter((slot) => slot.side === side && slot.type === "ban" && slot.champion);
  return { picks, bans };
}

function getSlotsByNumber(side, type, numbers) {
  return numbers.map((num) =>
    state.draftSlots.find(
      (slot) => slot.side === side && slot.type === type && slot.num === num
    ) || null
  );
}

function renderBoards() {
  const blue = getTeamSummary("blue");
  const red = getTeamSummary("red");

  elements.blueSummary.textContent = `${blue.picks.length} picks · ${blue.bans.length} bans`;
  elements.redSummary.textContent = `${red.picks.length} picks · ${red.bans.length} bans`;

  renderSlotRow(elements.blueBansEarly, getSlotsByNumber("blue", "ban", [1, 2, 3]));
  renderSlotRow(elements.bluePicksEarly, getSlotsByNumber("blue", "pick", [1, 2, 3]));
  renderSlotRow(elements.blueBansLate, getSlotsByNumber("blue", "ban", [4, 5]));
  renderSlotRow(elements.bluePicksLate, getSlotsByNumber("blue", "pick", [4, 5]));

  renderSlotRow(elements.redBansEarly, getSlotsByNumber("red", "ban", [1, 2, 3]));
  renderSlotRow(elements.redPicksEarly, getSlotsByNumber("red", "pick", [1, 2, 3]));
  renderSlotRow(elements.redBansLate, getSlotsByNumber("red", "ban", [4, 5]));
  renderSlotRow(elements.redPicksLate, getSlotsByNumber("red", "pick", [4, 5]));
}

function renderSlotRow(container, slotsByNumber) {
  container.innerHTML = "";
  slotsByNumber.forEach((slot) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (!slot || !slot.champion) {
      chip.classList.add("empty");
      chip.textContent = "Open";
      container.appendChild(chip);
      return;
    }
    if (slot.champion.image) {
      const img = document.createElement("img");
      img.src = `${CHAMPION_IMG_BASE}${slot.champion.image}`;
      img.alt = slot.champion.name;
      chip.appendChild(img);
    }
    const label = document.createElement("span");
    label.textContent = slot.champion.name;
    chip.appendChild(label);
    container.appendChild(chip);
  });
}

function renderTimeline() {
  const cards = elements.timeline.querySelectorAll(".slot");
  cards.forEach((card, index) => {
    const slot = state.draftSlots[index];
    const name = card.querySelector(".slot-name");
    const status = slot.champion ? slot.champion.name : "Open";
    name.textContent = status;
    if (index === state.activeIndex) {
      card.classList.add("active");
    } else {
      card.classList.remove("active");
    }
  });

  const current = getCurrentSlot();
  if (current) {
    const sideLabel = current.side === "blue" ? "Blue" : "Red";
    const typeLabel = current.type === "ban" ? "Ban" : "Pick";
    elements.currentSlot.textContent = `${sideLabel} ${typeLabel} ${current.num}`;
  } else {
    elements.currentSlot.textContent = "Draft complete";
  }
}

function renderChampionGrid() {
  const unavailable = getUnavailableSet();
  const query = normalize(state.searchQuery);
  const champions = state.champions.filter((champion) =>
    query ? champion.search.includes(query) : true
  );
  const availableCount = champions.filter((champion) => !unavailable.has(normalize(champion.name))).length;

  elements.poolCount.textContent = `${availableCount} available`;

  elements.championGrid.innerHTML = "";
  champions.forEach((champion) => {
    const isUnavailable = unavailable.has(normalize(champion.name));
    const card = document.createElement("div");
    card.className = "champion-card" + (isUnavailable ? " disabled" : "");
    card.dataset.name = champion.name;

    const img = document.createElement("img");
    img.src = champion.image ? `${CHAMPION_IMG_BASE}${champion.image}` : "";
    img.alt = champion.name;

    const name = document.createElement("div");
    name.className = "champion-name";
    name.textContent = champion.name;

    const tags = document.createElement("div");
    tags.className = "champion-tags";
    tags.textContent = champion.tags.join(" · ");

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(tags);

    if (!isUnavailable) {
      card.addEventListener("click", () => {
        handleChampionPick(champion, "user");
      });
    }

    elements.championGrid.appendChild(card);
  });
}

async function requestAiPick(slot) {
  const payload = {
    mode: state.mode,
    slot,
    draft: state.draftSlots.map((entry) => ({
      side: entry.side,
      type: entry.type,
      num: entry.num,
      champion: entry.champion ? entry.champion.name : null,
      source: entry.source
    })),
    fearlessLockout: Array.from(state.fearlessLockout),
    userSide: state.userSide
  };

  const url = `${state.apiBaseUrl.replace(/\/$/, "")}/draft/pick`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`AI API error ${response.status}`);
  }
  const data = await response.json();
  return data.champion || data.pick || data.name || null;
}

function pickRandomAvailable() {
  const unavailable = getUnavailableSet();
  const available = state.champions.filter((champion) => !unavailable.has(normalize(champion.name)));
  if (!available.length) {
    return null;
  }
  return available[Math.floor(Math.random() * available.length)];
}

async function handleAiPick() {
  const slot = getCurrentSlot();
  if (!slot) {
    setDraftStatus("Draft complete.");
    return;
  }

  if (state.isPicking) {
    return;
  }

  state.isPicking = true;
  setDraftStatus("AI picking...");
  try {
    const suggested = await requestAiPick(slot);
    const champion = suggested
      ? state.championMap.get(normalize(suggested))
      : null;

    if (champion) {
      handleChampionPick(champion, "ai");
      elements.apiStatus.textContent = "AI responded";
      return;
    }
    throw new Error("AI response not found in pool");
  } catch (error) {
    console.warn("AI pick failed", error);
    elements.apiStatus.textContent = "AI fallback: random";
    const fallback = pickRandomAvailable();
    if (fallback) {
      handleChampionPick(fallback, "ai");
      return;
    }
    setDraftStatus("No available champions.");
  } finally {
    state.isPicking = false;
  }
}

function handleChampionPick(champion, source) {
  const slot = getCurrentSlot();
  if (!slot) {
    return;
  }
  const unavailable = getUnavailableSet();
  if (unavailable.has(normalize(champion.name))) {
    return;
  }
  setChampionAt(state.activeIndex, champion, source);
  setDraftStatus(`${source.toUpperCase()} locked ${champion.name} for ${slot.side} ${slot.type} ${slot.num}`);
  render();
  maybeAutoPick();
}

async function maybeAutoPick() {
  if (state.mode !== "versus" || !state.autoAdvance) {
    return;
  }
  const aiSide = state.userSide === "blue" ? "red" : "blue";
  let slot = getCurrentSlot();
  while (slot && slot.side === aiSide) {
    await handleAiPick();
    slot = getCurrentSlot();
  }
}

function updateControls() {
  elements.apiBase.value = state.apiBaseUrl;
  elements.autoAdvance.checked = state.autoAdvance;
  elements.seriesGame.textContent = String(state.seriesGame);
  elements.lockoutCount.textContent = String(state.fearlessLockout.size);

  const modeButtons = elements.modeToggle.querySelectorAll("button");
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });

  const sideButtons = elements.sideToggle.querySelectorAll("button");
  sideButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.side === state.userSide);
  });
}

function render() {
  updateControls();
  renderTimeline();
  renderBoards();
  renderChampionGrid();
}

function bindEvents() {
  elements.modeToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    state.mode = button.dataset.mode || state.mode;
    persistConfig();
    render();
    maybeAutoPick();
  });

  elements.sideToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    state.userSide = button.dataset.side || state.userSide;
    persistConfig();
    render();
    maybeAutoPick();
  });

  elements.apiBase.addEventListener("change", () => {
    state.apiBaseUrl = elements.apiBase.value.trim() || DEFAULT_CONFIG.apiBaseUrl;
    persistConfig();
  });

  elements.autoAdvance.addEventListener("change", () => {
    state.autoAdvance = elements.autoAdvance.checked;
    persistConfig();
    maybeAutoPick();
  });

  elements.search.addEventListener("input", () => {
    state.searchQuery = elements.search.value;
    renderChampionGrid();
  });

  elements.aiPick.addEventListener("click", () => {
    handleAiPick();
  });

  elements.undoPick.addEventListener("click", () => {
    const undone = undoLast();
    setDraftStatus(undone ? "Undid last slot." : "Nothing to undo.");
    render();
  });

  elements.resetDraft.addEventListener("click", () => {
    resetDraft();
    setDraftStatus("Draft reset.");
    render();
  });

  elements.commitGame.addEventListener("click", () => {
    commitGame();
    setDraftStatus("Locked picks into fearless pool.");
    render();
  });

  elements.resetSeries.addEventListener("click", () => {
    resetSeries();
    setDraftStatus("Series reset.");
    render();
  });
}

async function init() {
  loadConfig();
  bindEvents();
  initTimeline();
  await loadChampionData();
  render();
  maybeAutoPick();
}

init();
