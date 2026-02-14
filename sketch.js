/*
  MAL Projection — GitHub Pages bulletproof version

  Fixes:
  - Auto-detect GitHub Pages base path (no hardcoded /mal_Projection/)
  - Tries multiple asset base paths and logs what works
  - Loads sprites only after confirming a reachable base
  - Forces TF backend away from WebGPU (removes webgpu backend if present)
  - Mirrors video + mirrors pose X so pushers line up
*/

let video;
let poseModel = null;
let poses = [];
let poseSystem = "none";

let ASSET_BASE = null; // chosen at runtime
const SPRITE_NAMES = ["Mal.png","Mal1.png","Mal2.png","Mal3.png","Mal4.png","Mal5.png","Mal6.png","Mal7.png","Mal8.png","Mal9.png"];

let spriteImgs = [];
let cornerTL, cornerBR;

// Matter.js
let Engine, World, Bodies, Body;
let engine, world;

// Simulation
let sprites = [];
let leftHandPusher, rightHandPusher, nosePusher;

const CFG = {
  spriteCount: 80,
  spriteScaleMin: 0.10,
  spriteScaleMax: 0.22,
  airFriction: 0.05,
  restitution: 0.85,
  gravityY: 0.001,
  pusherRadiusHand: 70,
  pusherRadiusNose: 85,
  poseConfidence: 0.15,
  showDebugPushers: false,
  showDebugText: false,
};

const CORNER = { padding: 50, tlScale: 0.7, brScale: 0.35 };

// ---------- helpers ----------
function ghPagesSiteRoot() {
  // If URL is https://user.github.io/repo/..., this returns "/repo/"
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}/` : "/";
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function pickAssetBase() {
  const siteRoot = ghPagesSiteRoot();
  const candidates = [
    `${siteRoot}assets/`,   // most common correct GH pages structure
    `./assets/`,            // sometimes works depending on where sketch is served
    `/assets/`,             // only works if assets at domain root (rare)
  ];

  // Probe a file you definitely have:
  const probeName = "Mal.png";
  for (const base of candidates) {
    const probeUrl = new URL(base + probeName, window.location.href).href;
    console.log("🔎 Probing:", probeUrl);
    if (await urlExists(probeUrl)) {
      console.log("✅ Asset base found:", base);
      return base;
    }
  }

  console.warn("❌ Could not find a working assets base. Check repo structure /assets next to index.html.");
  return candidates[0]; // default guess so errors are at least consistent
}

function loadImageAsync(path) {
  return new Promise((resolve) => {
    loadImage(
      path,
      (img) => resolve({ ok: true, img, path }),
      () => resolve({ ok: false, img: null, path })
    );
  });
}

async function loadAllAssets() {
  ASSET_BASE = await pickAssetBase();

  // Load corners with loud logs
  {
    const p = ASSET_BASE + "G.png";
    const res = await loadImageAsync(p);
    if (res.ok) {
      cornerTL = res.img;
      console.log("✅ loaded", p);
    } else {
      console.error("❌ failed", p);
    }
  }
  {
    const p = ASSET_BASE + "LNY.png";
    const res = await loadImageAsync(p);
    if (res.ok) {
      cornerBR = res.img;
      console.log("✅ loaded", p);
    } else {
      console.error("❌ failed", p);
    }
  }

  // Load sprites with loud logs
  const loaded = [];
  for (const name of SPRITE_NAMES) {
    const p = ASSET_BASE + name;
    const res = await loadImageAsync(p);
    if (res.ok) {
      loaded.push(res.img);
      console.log("✅ loaded", p);
    } else {
      console.error("❌ failed", p, "(case-sensitive on GitHub!)");
    }
  }

  spriteImgs = loaded;
}

// ---------- TF backend hardening ----------
async function forceTfNoWebGPU() {
  if (typeof tf === "undefined") return;

  try {
    // If webgpu backend is registered, remove it so tf won't try it
    if (tf.removeBackend) {
      try { tf.removeBackend("webgpu"); } catch (e) {}
    }

    // Force webgl; fall back to cpu
    if (tf.setBackend && tf.ready) {
      try {
        await tf.setBackend("webgl");
        await tf.ready();
        console.log("✅ TF backend forced to webgl");
        return;
      } catch (e) {}

      await tf.setBackend("cpu");
      await tf.ready();
      console.log("✅ TF backend forced to cpu");
    }
  } catch (e) {
    console.warn("⚠️ TF backend forcing failed:", e);
  }
}

// ---------- p5 preload/setup/draw ----------
function preload() {
  // IMPORTANT: we don’t load images here anymore because we want async base probing.
  // preload() must be synchronous; GitHub Pages path probing is easier async in setup().
}

async function setup() {
  createCanvas(windowWidth, windowHeight);

  if (typeof Matter === "undefined") throw new Error("Matter.js not found.");
  if (typeof ml5 === "undefined") throw new Error("ml5.js not found.");

  // Matter bind + world
  Engine = Matter.Engine;
  World = Matter.World;
  Bodies = Matter.Bodies;
  Body = Matter.Body;

  engine = Engine.create();
  world = engine.world;
  world.gravity.y = CFG.gravityY;

  // Load assets (async)
  await loadAllAssets();

  // Create sprites once images exist
  sprites = [];
  if (spriteImgs.length === 0) {
    console.warn("⚠️ No sprite images loaded. Your assets are NOT reachable at:", ASSET_BASE);
  } else {
    for (let i = 0; i < CFG.spriteCount; i++) {
      const img = random(spriteImgs);
      const scale = random(CFG.spriteScaleMin, CFG.spriteScaleMax);
      sprites.push(new SpriteBody(random(60, width - 60), random(60, height - 60), img, scale));
    }
  }

  // Pushers
  leftHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  rightHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  nosePusher = new PusherBody(0, 0, CFG.pusherRadiusNose);

  // Camera
  const constraints = { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  video = createCapture(constraints);
  video.size(windowWidth, windowHeight);
  video.elt.setAttribute("playsinline", "");
  video.elt.muted = true;
  video.hide();

  video.elt.onloadedmetadata = () => startPose();
}

async function startPose() {
  try {
    await forceTfNoWebGPU();

    const playPromise = video.elt.play();
    if (playPromise && typeof playPromise.then === "function") await playPromise;

    if (typeof ml5.bodyPose === "function") {
      poseSystem = "bodyPose";
      console.log("✅ Using ml5.bodyPose(video)");
      let maybe = ml5.bodyPose(video);
      poseModel = (maybe && typeof maybe.then === "function") ? await maybe : maybe;

      poseModel.detectStart(video, (results) => {
        poses = results || [];
      });

      console.log("✅ BodyPose started");
      return;
    }

    if (typeof ml5.poseNet === "function") {
      poseSystem = "poseNet";
      console.log("✅ Falling back to ml5.poseNet(video)");
      poseModel = ml5.poseNet(video, () => console.log("✅ PoseNet model loaded"));
      poseModel.on("pose", (results) => {
        poses = (results || []).map((r) => ({
          keypoints: (r.pose?.keypoints || []).map((k) => ({
            name: k.part,
            x: k.position.x,
            y: k.position.y,
            confidence: k.score,
          })),
        }));
      });
      console.log("✅ PoseNet started");
      return;
    }

    throw new Error("Neither ml5.bodyPose nor ml5.poseNet is available.");
  } catch (err) {
    console.error("❌ Pose init failed:", err);
  }
}

function draw() {
  background(0);

  // mirrored video
  if (video) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();
  }

  if (engine) Engine.update(engine);

  for (const s of sprites) {
    s.show();
    s.bounceOffEdges();
  }

  updatePushersFromPose();

  if (CFG.showDebugPushers) {
    leftHandPusher.showDebug();
    rightHandPusher.showDebug();
    nosePusher.showDebug();
  }

  drawFixedCorners();

  if (CFG.showDebugText) {
    push();
    fill(0, 255, 0);
    noStroke();
    textSize(16);
    text(`poseSystem: ${poseSystem}`, 20, 26);
    text(`poses: ${poses.length}`, 20, 46);
    text(`spritesLoaded: ${spriteImgs.length}`, 20, 66);
    text(`ASSET_BASE: ${ASSET_BASE || "none"}`, 20, 86);
    if (spriteImgs.length === 0) {
      fill(255, 80, 80);
      textSize(18);
      text("⚠️ Sprites not loading. The probe URLs in console will tell you the real path.", 20, 112);
    }
    pop();
  }
}

function drawFixedCorners() {
  if (!cornerTL || !cornerBR) return;
  imageMode(CORNER);

  const tlW = cornerTL.width * CORNER.tlScale;
  const tlH = cornerTL.height * CORNER.tlScale;
  image(cornerTL, CORNER.padding, CORNER.padding, tlW, tlH);

  const brW = cornerBR.width * CORNER.brScale;
  const brH = cornerBR.height * CORNER.brScale;
  image(cornerBR, width - brW - CORNER.padding, height - brH - CORNER.padding, brW, brH);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (video) video.size(windowWidth, windowHeight);
}

function updatePushersFromPose() {
  if (!poses || poses.length === 0) return;
  const first = poses[0];
  if (!first || !first.keypoints) return;

  for (const kp of first.keypoints) {
    if (!kp) continue;
    const conf = kp.confidence ?? kp.score ?? 0;
    if (conf < CFG.poseConfidence) continue;

    const x = kp.x ?? kp.position?.x;
    const y = kp.y ?? kp.position?.y;
    if (x == null || y == null) continue;

    const fx = width - x;
    const name = kp.name || kp.part || "";

    if (name === "left_wrist" || name === "leftWrist") leftHandPusher.setPosition(fx, y);
    else if (name === "right_wrist" || name === "rightWrist") rightHandPusher.setPosition(fx, y);
    else if (name === "nose") nosePusher.setPosition(fx, y);
  }
}

// ---------- Classes ----------
class SpriteBody {
  constructor(x, y, img, scale) {
    this.img = img;
    this.scale = scale;

    const w = max(20, img.width * scale);
    const h = max(20, img.height * scale);
    this.r = max(w, h) * 0.5;

    this.body = Bodies.circle(x, y, this.r, {
      frictionAir: CFG.airFriction,
      restitution: CFG.restitution,
    });

    Body.setVelocity(this.body, { x: random(-1.2, 1.2), y: random(-1.2, 1.2) });
    World.add(world, this.body);
  }

  show() {
    const pos = this.body.position;
    const angle = this.body.angle;

    push();
    translate(pos.x, pos.y);
    rotate(angle);
    imageMode(CENTER);
    image(this.img, 0, 0, this.img.width * this.scale, this.img.height * this.scale);
    pop();
  }

  bounceOffEdges() {
    const pos = this.body.position;
    const v = this.body.velocity;

    if (pos.x - this.r < 0) {
      Body.setPosition(this.body, { x: this.r, y: pos.y });
      Body.setVelocity(this.body, { x: abs(v.x), y: v.y });
    } else if (pos.x + this.r > width) {
      Body.setPosition(this.body, { x: width - this.r, y: pos.y });
      Body.setVelocity(this.body, { x: -abs(v.x), y: v.y });
    }

    if (pos.y - this.r < 0) {
      Body.setPosition(this.body, { x: pos.x, y: this.r });
      Body.setVelocity(this.body, { x: v.x, y: abs(v.y) });
    } else if (pos.y + this.r > height) {
      Body.setPosition(this.body, { x: pos.x, y: height - this.r });
      Body.setVelocity(this.body, { x: v.x, y: -abs(v.y) });
    }
  }
}

class PusherBody {
  constructor(x, y, r) {
    this.r = r;
    this.body = Bodies.circle(x, y, r, { isStatic: true });
    World.add(world, this.body);
  }

  setPosition(x, y) {
    Body.setPosition(this.body, { x, y });
  }

  showDebug() {
    const pos = this.body.position;
    push();
    noFill();
    stroke(0, 255, 255);
    strokeWeight(3);
    circle(pos.x, pos.y, this.r * 2);
    pop();
  }
}
