const BASE_DRAFT_ORDER = [
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

function getDraftOrder(firstPickSide) {
  if (firstPickSide !== "red") {
    return BASE_DRAFT_ORDER;
  }
  return BASE_DRAFT_ORDER.map((slot) => ({
    ...slot,
    side: slot.side === "blue" ? "red" : "blue"
  }));
}

function buildDraftSlots(firstPickSide) {
  return getDraftOrder(firstPickSide).map((slot) => ({ ...slot, champion: null, source: null }));
}

const CHAMPION_SOURCES = [
  {
    data: "/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/data/en_US/champion.json",
    imgBase: "/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/img/champion/"
  },
  {
    data: "/draft-sage/resources/champions.json",
    imgBase: null
  },
  {
    data: "../../lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/data/en_US/champion.json",
    imgBase: "../../lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/img/champion/"
  },
  {
    data: "../resources/champions.json",
    imgBase: null
  }
];

const DEFAULT_CONFIG = {
  mode: "interactive",
  userSide: "blue",
  firstPickSide: "blue",
  apiBaseUrl: "http://localhost:8001",
  autoAdvance: true
};
const AI_REQUEST_TIMEOUT_MS = 6000;

const state = {
  champions: [],
  championMap: new Map(),
  championImgBase: null,
  activeIndex: 0,
  firstPickSide: DEFAULT_CONFIG.firstPickSide,
  draftSlots: buildDraftSlots(DEFAULT_CONFIG.firstPickSide),
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
  firstPickToggle: document.getElementById("first-pick-toggle"),
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
  blueBansEarly: document.getElementById("blue-bans-early"),
  bluePick1: document.getElementById("blue-pick-1"),
  bluePick2: document.getElementById("blue-pick-2"),
  bluePick3: document.getElementById("blue-pick-3"),
  blueBansLate: document.getElementById("blue-bans-late"),
  bluePick4: document.getElementById("blue-pick-4"),
  bluePick5: document.getElementById("blue-pick-5"),
  redBansEarly: document.getElementById("red-bans-early"),
  redPick1: document.getElementById("red-pick-1"),
  redPick2: document.getElementById("red-pick-2"),
  redPick3: document.getElementById("red-pick-3"),
  redBansLate: document.getElementById("red-bans-late"),
  redPick4: document.getElementById("red-pick-4"),
  redPick5: document.getElementById("red-pick-5"),
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
      state.firstPickSide = parsed.firstPickSide === "red" ? "red" : "blue";
      state.apiBaseUrl = parsed.apiBaseUrl || state.apiBaseUrl;
      state.autoAdvance = typeof parsed.autoAdvance === "boolean" ? parsed.autoAdvance : state.autoAdvance;
    } catch (error) {
      console.warn("Failed to load config", error);
    }
  }
  state.draftSlots = buildDraftSlots(state.firstPickSide);
  state.activeIndex = 0;
}

function persistConfig() {
  window.localStorage.setItem(
    "draft-sage-ui",
    JSON.stringify({
      mode: state.mode,
      userSide: state.userSide,
      firstPickSide: state.firstPickSide,
      apiBaseUrl: state.apiBaseUrl,
      autoAdvance: state.autoAdvance
    })
  );
}

async function loadChampionData() {
  let lastError = null;
  for (const source of CHAMPION_SOURCES) {
    try {
      const response = await fetch(source.data);
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
      state.championImgBase = source.imgBase;
      elements.championSource.textContent = source.data;
      elements.poolTotal.textContent = `${champions.length} total`;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Failed to load champion data", lastError);
  elements.championSource.textContent = "Missing champion data";
}

function getSlotIndex(side, type, num) {
  return state.draftSlots.findIndex(
    (slot) => slot.side === side && slot.type === type && slot.num === num
  );
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
  state.activeIndex = nextIndex !== null ? nextIndex : state.draftSlots.length;
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
  state.draftSlots = buildDraftSlots(state.firstPickSide);
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
  const picks = state.draftSlots.filter(
    (slot) => slot.side === side && slot.type === "pick" && slot.champion
  );
  const bans = state.draftSlots.filter(
    (slot) => slot.side === side && slot.type === "ban" && slot.champion
  );
  return { picks, bans };
}

function getSlotsByNumber(side, type, numbers) {
  return numbers.map((num) => {
    const index = getSlotIndex(side, type, num);
    return { slot: state.draftSlots[index], index };
  });
}

function renderDraftGrid() {
  const blue = getTeamSummary("blue");
  const red = getTeamSummary("red");

  elements.blueSummary.textContent = `${blue.picks.length} picks · ${blue.bans.length} bans`;
  elements.redSummary.textContent = `${red.picks.length} picks · ${red.bans.length} bans`;

  renderSlotCards(elements.blueBansEarly, getSlotsByNumber("blue", "ban", [1, 2, 3]));
  renderSlotCards(elements.bluePick1, getSlotsByNumber("blue", "pick", [1]));
  renderSlotCards(elements.bluePick2, getSlotsByNumber("blue", "pick", [2]));
  renderSlotCards(elements.bluePick3, getSlotsByNumber("blue", "pick", [3]));
  renderSlotCards(elements.blueBansLate, getSlotsByNumber("blue", "ban", [4, 5]));
  renderSlotCards(elements.bluePick4, getSlotsByNumber("blue", "pick", [4]));
  renderSlotCards(elements.bluePick5, getSlotsByNumber("blue", "pick", [5]));

  renderSlotCards(elements.redBansEarly, getSlotsByNumber("red", "ban", [1, 2, 3]));
  renderSlotCards(elements.redPick1, getSlotsByNumber("red", "pick", [1]));
  renderSlotCards(elements.redPick2, getSlotsByNumber("red", "pick", [2]));
  renderSlotCards(elements.redPick3, getSlotsByNumber("red", "pick", [3]));
  renderSlotCards(elements.redBansLate, getSlotsByNumber("red", "ban", [4, 5]));
  renderSlotCards(elements.redPick4, getSlotsByNumber("red", "pick", [4]));
  renderSlotCards(elements.redPick5, getSlotsByNumber("red", "pick", [5]));
}

function renderSlotCards(container, slotRefs) {
  container.innerHTML = "";
  slotRefs.forEach(({ slot, index }) => {
    if (!slot) {
      return;
    }
    const card = document.createElement("div");
    card.className = `slot ${slot.side}`;
    if (index === state.activeIndex) {
      card.classList.add("active");
    }
    const meta = document.createElement("div");
    meta.className = "slot-meta";
    meta.innerHTML = `<span>${slot.type.toUpperCase()}</span><span>${slot.num}</span>`;

    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = slot.champion ? slot.champion.name : "Open";

    card.appendChild(meta);
    card.appendChild(name);
    card.addEventListener("click", () => {
      state.activeIndex = index;
      render();
    });
    container.appendChild(card);
  });
}

function renderCurrentSlot() {
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
    img.src =
      state.championImgBase && champion.image ? `${state.championImgBase}${champion.image}` : "";
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
    firstPickSide: state.firstPickSide,
    userSide: state.userSide
  };

  const url = `${state.apiBaseUrl.replace(/\/$/, "")}/draft/pick`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = await response.json();
      if (errorPayload && typeof errorPayload === "object") {
        detail = errorPayload.error || JSON.stringify(errorPayload);
      }
    } catch (err) {
      detail = "";
    }
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`AI API error ${response.status}${suffix}`);
  }
  const data = await response.json();
  return data.champion || data.pick || data.name || null;
}

async function checkApiHealth() {
  const url = `${state.apiBaseUrl.replace(/\/$/, "")}/health`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      elements.apiStatus.textContent = `API error ${response.status}`;
      return;
    }
    elements.apiStatus.textContent = "API ok";
  } catch (error) {
    const message = error?.name === "AbortError" ? "API timeout" : "API unreachable";
    elements.apiStatus.textContent = message;
  } finally {
    window.clearTimeout(timer);
  }
}

async function handleAiPick() {
  const slot = getCurrentSlot();
  if (!slot) {
    setDraftStatus("Draft complete.");
    return false;
  }

  if (!state.champions.length) {
    const message =
      "Champion data is missing. Serve the repo root or update CHAMPION_SOURCES.";
    elements.apiStatus.textContent = "AI blocked: missing champion data";
    setDraftStatus(message);
    window.alert(message);
    return false;
  }

  if (state.isPicking) {
    return false;
  }

  if (slot.champion) {
    const message = "Active slot already filled. Select an open slot.";
    elements.apiStatus.textContent = "AI blocked: slot filled";
    setDraftStatus(message);
    window.alert(message);
    return false;
  }

  state.isPicking = true;
  setDraftStatus("AI picking...");
  try {
    const suggested = await requestAiPick(slot);
    const champion = suggested
      ? state.championMap.get(normalize(suggested))
      : null;

    if (champion) {
      const didPick = handleChampionPick(champion, "ai");
      if (!didPick) {
        throw new Error("AI returned an unavailable champion");
      }
      elements.apiStatus.textContent = "AI responded";
      return true;
    }
    throw new Error("AI response not found in pool");
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "AI request timed out"
      : error?.message
        ? error.message
        : "AI error";
    console.warn("AI pick failed", error);
    elements.apiStatus.textContent = `AI error: ${message}`;
    setDraftStatus(`AI failed: ${message}`);
    window.alert(`AI failed: ${message}`);
    return false;
  } finally {
    state.isPicking = false;
  }
}

function handleChampionPick(champion, source) {
  const slot = getCurrentSlot();
  if (!slot) {
    return false;
  }
  const unavailable = getUnavailableSet();
  if (unavailable.has(normalize(champion.name))) {
    return false;
  }
  setChampionAt(state.activeIndex, champion, source);
  setDraftStatus(`${source.toUpperCase()} locked ${champion.name} for ${slot.side} ${slot.type} ${slot.num}`);
  render();
  maybeAutoPick();
  return true;
}

async function maybeAutoPick() {
  if (state.mode !== "versus" || !state.autoAdvance) {
    return;
  }
  const aiSide = state.userSide === "blue" ? "red" : "blue";
  let slot = getCurrentSlot();
  while (slot && slot.side === aiSide) {
    const didPick = await handleAiPick();
    if (!didPick) {
      return;
    }
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

  const firstPickButtons = elements.firstPickToggle.querySelectorAll("button");
  firstPickButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.firstPick === state.firstPickSide);
  });
}

function render() {
  updateControls();
  renderCurrentSlot();
  renderDraftGrid();
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

  elements.firstPickToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }
    const selected = button.dataset.firstPick === "red" ? "red" : "blue";
    if (selected === state.firstPickSide) {
      return;
    }
    state.firstPickSide = selected;
    resetDraft();
    persistConfig();
    render();
    const sideLabel = selected === "red" ? "Red" : "Blue";
    setDraftStatus(`Draft reset. ${sideLabel} side has first pick.`);
    maybeAutoPick();
  });

  elements.apiBase.addEventListener("change", () => {
    state.apiBaseUrl = elements.apiBase.value.trim() || DEFAULT_CONFIG.apiBaseUrl;
    persistConfig();
    checkApiHealth();
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
  await loadChampionData();
  render();
  checkApiHealth();
  maybeAutoPick();
}

init();
