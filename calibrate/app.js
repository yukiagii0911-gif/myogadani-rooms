// === キャリブレーションツール (Konva版) ===
// 各階の外形を背景に、教室矩形を Konva Stage に配置・編集
// Transformer で隅ドラッグ・回転ハンドル付き

const FLOORS = ["-1", "1", "2", "3", "5", "6"];
const FLOOR_LABELS = { "-1": "B1", "1": "1F", "2": "2F", "3": "3F", "5": "5F", "6": "6F" };

const FLOOR_ROOMS = {
  "-1": ["B1C16", "B1E04", "B1W01", "B1W02"],
  "1": ["1W01"],
  "2": ["2C02", "2C03", "2E02", "2E03", "2E04", "2E05", "2E06", "2E07", "2E08", "2W01", "2W02"],
  "3": [
    "3N02", "3N04", "3C02", "3C03", "3C13",
    "3E02", "3E03", "3E04", "3E05", "3E06", "3E07", "3E08", "3E09", "3E10",
    "3W01", "3W02"
  ],
  "5": [
    "5N01", "5N02", "5N03", "5N04", "5N05", "5N06",
    "5C02", "5C03", "5C04", "5C06", "5C08", "5C09", "5C10", "5C11",
    "5W01", "5W02", "5W03", "5W04", "5W05", "5W06", "5W07", "5W08", "5W09", "5W10"
  ],
  "6": [
    "6C03", "6C04", "6C05", "6C07", "6C08", "6C09", "6C10", "6C11",
    "6C12", "6C13", "6C14", "6C15", "6C16",
    "6W01", "6W02", "6W03", "6W04", "6W05", "6W06", "6W07", "6W08", "6W09", "6W10", "6W11", "6W12"
  ],
};

const STORAGE_KEY = "myogadani-calibration-v1";
const DEFAULT_ROOM = { w: 60, h: 40, angle: 0 };

const state = {
  floor: "5",
  activeRoom: null,
  data: loadData(),
  viewBox: null,
  stage: null,
  bgLayer: null,
  roomLayer: null,
  transformer: null,
  selectedNode: null,
  outlineImage: null,
};

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }

function ensureFloor(f) {
  if (!state.data[f]) state.data[f] = { rooms: {}, customRooms: [] };
  if (!state.data[f].rooms) state.data[f].rooms = {};
  if (!state.data[f].customRooms) state.data[f].customRooms = [];
  return state.data[f];
}

function getFloorRoomList(f) {
  return [...(FLOOR_ROOMS[f] || []), ...(ensureFloor(f).customRooms || [])];
}

const $ = (id) => document.getElementById(id);
const floorTabs = $("floor-tabs");
const roomList = $("room-list");
const adjusters = $("adjusters");
const arName = $("ar-name");
const arStatus = $("ar-status");
const imageEmpty = $("image-empty");
const toast = $("toast");

// === Floor tabs ===
function renderFloorTabs() {
  floorTabs.innerHTML = FLOORS.map((f) => {
    const total = getFloorRoomList(f).length;
    const done = Object.keys(ensureFloor(f).rooms).length;
    const on = state.floor === f ? " on" : "";
    return `<button class="floor-tab${on}" data-floor="${f}">${FLOOR_LABELS[f]}<span class="done-count">${done}/${total}</span></button>`;
  }).join("");
}
floorTabs.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-floor]");
  if (!t) return;
  state.floor = t.dataset.floor;
  state.activeRoom = null;
  state.selectedNode = null;
  await renderAll();
});

// === 外形SVGロード ===
async function loadOutlineSvg() {
  const res = await fetch("./outlines/outline.svg");
  if (!res.ok) throw new Error("外形SVG読込失敗");
  const svgText = await res.text();
  // viewBox を取り出す
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const srcSvg = doc.querySelector("svg");
  const vb = srcSvg.getAttribute("viewBox").split(/\s+/).map(Number);
  // Image オブジェクトとして読み込む
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  });
  return { img, vb };
}

// === Stage 初期化 ===
async function initStage() {
  imageEmpty.hidden = true;
  // 既存ステージを破棄
  if (state.stage) { state.stage.destroy(); state.stage = null; }

  try {
    const { img, vb } = await loadOutlineSvg();
    state.viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    state.outlineImage = img;
  } catch (e) {
    imageEmpty.hidden = false;
    $("image-empty-msg").textContent = "外形読み込み失敗";
    return;
  }

  const container = $("konva-container");
  const containerRect = container.getBoundingClientRect();

  // Stage は viewBox のサイズに合わせる。CSS で見た目を 100% にする
  const stage = new Konva.Stage({
    container: "konva-container",
    width: state.viewBox.w,
    height: state.viewBox.h,
  });

  // Stage を CSS で容器に fit-contain させる
  fitStageToContainer(stage, container);
  window.addEventListener("resize", () => fitStageToContainer(stage, container));

  // 背景レイヤ (外形)
  const bgLayer = new Konva.Layer({ listening: false });
  const bgImg = new Konva.Image({
    x: 0,
    y: 0,
    width: state.viewBox.w,
    height: state.viewBox.h,
    image: state.outlineImage,
  });
  bgLayer.add(bgImg);
  stage.add(bgLayer);

  // 教室レイヤ
  const roomLayer = new Konva.Layer();
  stage.add(roomLayer);

  // Transformer (選択中の教室につける)
  const transformer = new Konva.Transformer({
    rotateEnabled: true,
    enabledAnchors: [
      "top-left", "top-center", "top-right",
      "middle-left", "middle-right",
      "bottom-left", "bottom-center", "bottom-right",
    ],
    rotationSnaps: [0, 5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, -5, -10, -15, -20, -25, -30, -45, -60, -75, -90, -105, -120, -135, -150, -165],
    rotationSnapTolerance: 4,
    borderStroke: "#5c9fd0",
    borderStrokeWidth: 2,
    anchorStroke: "#5c9fd0",
    anchorFill: "#fff",
    anchorSize: 12,
    anchorCornerRadius: 6,
    keepRatio: false,
  });
  roomLayer.add(transformer);

  // Stage クリックで新規配置 or 選択解除
  stage.on("click tap", (e) => {
    if (e.target === stage || e.target.getClassName() === "Image") {
      // 背景タップ
      if (state.activeRoom) {
        const f = ensureFloor(state.floor);
        if (!f.rooms[state.activeRoom]) {
          // 新規配置 (タップ位置を中心に)
          const pos = stage.getPointerPosition();
          const stagePos = {
            x: (pos.x - stage.x()) / stage.scaleX(),
            y: (pos.y - stage.y()) / stage.scaleY(),
          };
          const w = DEFAULT_ROOM.w, h = DEFAULT_ROOM.h;
          f.rooms[state.activeRoom] = {
            x: Math.round(stagePos.x - w / 2),
            y: Math.round(stagePos.y - h / 2),
            w, h, angle: 0,
          };
          saveData();
          renderRooms();
          renderActive();
          renderRoomList();
          renderFloorTabs();
          showToast(`${state.activeRoom} 配置`);
          selectRoom(state.activeRoom);
        } else {
          // 既配置 → 選択解除
          deselectRoom();
        }
      }
    }
  });

  state.stage = stage;
  state.bgLayer = bgLayer;
  state.roomLayer = roomLayer;
  state.transformer = transformer;

  renderRooms();
}

function fitStageToContainer(stage, container) {
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const sx = rect.width / state.viewBox.w;
  const sy = rect.height / state.viewBox.h;
  const scale = Math.min(sx, sy);
  const w = state.viewBox.w * scale;
  const h = state.viewBox.h * scale;
  const x = (rect.width - w) / 2;
  const y = (rect.height - h) / 2;
  stage.scale({ x: scale, y: scale });
  stage.position({ x, y });
  stage.width(rect.width);
  stage.height(rect.height);
  stage.batchDraw();
}

// === 教室レンダ ===
function renderRooms() {
  if (!state.roomLayer) return;
  state.transformer.nodes([]);
  // 既存ノードを削除 (Transformer 以外)
  state.roomLayer.find("Group, Text").forEach((n) => n.destroy());
  state.selectedNode = null;

  const f = ensureFloor(state.floor);
  // viewBox オフセット
  const ox = state.viewBox.x;
  const oy = state.viewBox.y;

  for (const [name, pos] of Object.entries(f.rooms)) {
    const cx = (pos.x - ox) + pos.w / 2;
    const cy = (pos.y - oy) + pos.h / 2;
    // 矩形 (回転対応)
    const rect = new Konva.Rect({
      x: cx,
      y: cy,
      width: pos.w,
      height: pos.h,
      offsetX: pos.w / 2,
      offsetY: pos.h / 2,
      rotation: pos.angle || 0,
      fill: "rgba(178, 242, 187, 0.85)",
      stroke: "#2e6b3a",
      strokeWidth: 1.5,
      cornerRadius: 4,
      draggable: true,
      name: "room",
    });
    rect.setAttr("roomName", name);
    // ラベル (回転しない・中央に)
    const label = new Konva.Text({
      text: name,
      fontSize: 11,
      fontFamily: "system-ui, -apple-system, 'Hiragino Sans', sans-serif",
      fontStyle: "bold",
      fill: "#3a332d",
      stroke: "#ffffff",
      strokeWidth: 3,
      fillAfterStrokeEnabled: true,
      listening: false,
    });
    label.x(cx - label.width() / 2);
    label.y(cy - label.height() / 2);
    label.setAttr("forRoom", name);

    rect.on("click tap", (e) => {
      e.cancelBubble = true;
      selectRoom(name);
    });
    rect.on("dragmove", () => {
      label.x(rect.x() - label.width() / 2);
      label.y(rect.y() - label.height() / 2);
    });
    rect.on("transform", () => {
      // Transformer はスケールで変形する → 実寸 width/height に反映してスケールをリセット
      const sx = rect.scaleX();
      const sy = rect.scaleY();
      if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
        const nw = Math.max(10, rect.width() * sx);
        const nh = Math.max(10, rect.height() * sy);
        rect.width(nw);
        rect.height(nh);
        rect.offsetX(nw / 2);
        rect.offsetY(nh / 2);
        rect.scaleX(1);
        rect.scaleY(1);
      }
      label.x(rect.x() - label.width() / 2);
      label.y(rect.y() - label.height() / 2);
    });
    rect.on("dragend transformend", () => {
      // データに反映
      const d = ensureFloor(state.floor);
      d.rooms[name] = {
        x: Math.round(rect.x() - rect.width() / 2 + ox),
        y: Math.round(rect.y() - rect.height() / 2 + oy),
        w: Math.round(rect.width()),
        h: Math.round(rect.height()),
        angle: Math.round(rect.rotation() * 10) / 10,
      };
      saveData();
    });

    state.roomLayer.add(rect);
    state.roomLayer.add(label);
  }
  state.roomLayer.batchDraw();

  // 選択状態を復元
  if (state.activeRoom) {
    selectRoom(state.activeRoom);
  }
}

function selectRoom(name) {
  state.activeRoom = name;
  const rect = state.roomLayer.findOne((n) => n.getAttr("roomName") === name);
  if (rect) {
    state.transformer.nodes([rect]);
    state.selectedNode = rect;
    rect.moveToTop();
    // ラベルを上に持ってくる
    state.roomLayer.find("Text").forEach((t) => {
      if (t.getAttr("forRoom") === name) t.moveToTop();
    });
    state.roomLayer.add(state.transformer);
    state.transformer.moveToTop();
  } else {
    state.transformer.nodes([]);
    state.selectedNode = null;
  }
  state.roomLayer.batchDraw();
  renderActive();
  renderRoomList();
}

function deselectRoom() {
  state.activeRoom = null;
  state.transformer.nodes([]);
  state.selectedNode = null;
  state.roomLayer.batchDraw();
  renderActive();
  renderRoomList();
}

function renderActive() {
  if (!state.activeRoom) {
    arName.textContent = "教室を選んで →";
    arStatus.textContent = "下のリストからタップ";
    adjusters.hidden = true;
    return;
  }
  arName.textContent = state.activeRoom;
  const f = ensureFloor(state.floor);
  if (f.rooms[state.activeRoom]) {
    arStatus.textContent = "ハンドルで変形・移動";
    adjusters.hidden = false;
  } else {
    arStatus.textContent = "画像をタップで配置";
    adjusters.hidden = true;
  }
}

// === Room list ===
function renderRoomList() {
  const f = ensureFloor(state.floor);
  const rooms = getFloorRoomList(state.floor);
  roomList.innerHTML = rooms.map((name) => {
    const done = !!f.rooms[name];
    const active = name === state.activeRoom;
    return `<li data-name="${name}" class="${done ? "done" : ""} ${active ? "active" : ""}">${name}</li>`;
  }).join("");
}
roomList.addEventListener("click", (e) => {
  const li = e.target.closest("[data-name]");
  if (!li) return;
  selectRoom(li.dataset.name);
});

// === 教室追加 ===
$("btn-add-custom").addEventListener("click", () => {
  const name = prompt("教室名を入力 (例: 5C05)");
  if (!name) return;
  const f = ensureFloor(state.floor);
  if (!f.customRooms.includes(name) && !(FLOOR_ROOMS[state.floor] || []).includes(name)) {
    f.customRooms.push(name);
  }
  saveData();
  renderRoomList();
  selectRoom(name);
});

// === アクション ===
$("btn-delete").addEventListener("click", () => {
  if (!state.activeRoom) return;
  const f = ensureFloor(state.floor);
  delete f.rooms[state.activeRoom];
  saveData();
  renderRooms();
  renderActive();
  renderRoomList();
  renderFloorTabs();
  showToast(`${state.activeRoom} 削除`);
});
$("btn-next").addEventListener("click", () => {
  const rooms = getFloorRoomList(state.floor);
  const f = ensureFloor(state.floor);
  const idx = rooms.indexOf(state.activeRoom);
  for (let i = idx + 1; i < rooms.length; i++) {
    if (!f.rooms[rooms[i]]) { selectRoom(rooms[i]); return; }
  }
  const firstUnplaced = rooms.find((r) => !f.rooms[r]);
  if (firstUnplaced) selectRoom(firstUnplaced);
  else showToast("この階すべて配置済み");
});

// === Export ===
$("btn-export").addEventListener("click", async () => {
  const f = ensureFloor(state.floor);
  const out = {
    floor: state.floor,
    floorLabel: FLOOR_LABELS[state.floor],
    rooms: f.rooms,
  };
  const text = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("JSON コピーしました");
  } catch {
    prompt("コピー用JSON", text);
  }
});

// === Toast ===
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
}

// === Render all ===
async function renderAll() {
  renderFloorTabs();
  await initStage();
  renderRoomList();
  renderActive();
}

// === Seed 読込 ===
async function loadSeedIfNeeded() {
  try {
    const res = await fetch("./seed.json", { cache: "no-cache" });
    if (!res.ok) return;
    const seed = await res.json();
    let updated = false;
    for (const [floor, data] of Object.entries(seed)) {
      const cur = state.data[floor];
      const curCount = cur && cur.rooms ? Object.keys(cur.rooms).length : 0;
      if (curCount === 0) {
        state.data[floor] = state.data[floor] || { customRooms: [] };
        state.data[floor].rooms = data.rooms;
        updated = true;
      }
    }
    if (updated) {
      saveData();
      if (state.stage) renderRooms();
      renderFloorTabs();
      renderRoomList();
    }
  } catch {}
}

// Init
(async () => {
  await renderAll();
  await loadSeedIfNeeded();
})();
