/*
  PNG SPRITES + POSE (BodyPose or PoseNet fallback) + MATTER.JS
  GitHub Pages–safe + debug-friendly

  What this version fixes vs your current file:
  1) ✅ SPRITE_FILES array is valid JS (you were missing commas, which breaks the whole sketch)
  2) ✅ Uses "./assets/..." paths everywhere + logs which images fail to load
  3) ✅ Starts pose detection safely:
     - If ml5.bodyPose exists: uses it
     - Otherwise falls back to ml5.poseNet (works with ml5 v0.12.2)
  4) ✅ Mirrors the video AND mirrors pose X so pushers match what you see
  5) ✅ Shows debug text: sprites loaded count + poses count + which pose system is active
*/

// ---------- ml5 pose ----------
let video;
let poseModel = null;      // can be BodyPose model or PoseNet model
let poses = [];            // normalized format: [{ keypoints:[{name,x,y,confidence}, ...] }]

// ---------- PNG sprites ----------
const SPRITE_FILES = [
  "./assets/Mal.png",
  "./assets/Mal1.png",
  "./assets/Mal2.png",
  "./assets/Mal3.png",
  "./assets/Mal4.png",
  "./assets/Mal5.png",
  "./assets/Mal6.png",
  "./assets/Mal7.png",
  "./assets/Mal8.png",
  "./assets/Mal9.png",
];

let spriteImgs = [];
let cornerTL, cornerBR;

// ---------- Matter.js ----------
let Engine, World, Bodies, Body;
let engine, world;

// ---------- Simulation ----------
let sprites = [];
let leftHandPusher, rightHandPusher, nosePusher;

// ---------- Debug ----------
let poseSystem = "none"; // "bodyPose" | "poseNet" | "none"

// ---------- Config ----------
const CFG = {
  spriteCount: 25,
  spriteScaleMin: 0.10,
  spriteScaleMax: 0.22,
  airFriction: 0.05,
  restitution: 0.85,
  gravityY: 0.001,
  pusherRadiusHand: 70,
  pusherRadiusNose: 85,
  poseConfidence: 0.15,
  showDebugPushers: false,
  showDebugText: true,
};

const CORNER = {
  padding: 50,
  tlScale: 0.7,
  brScale: 0.35,
};

function preload() {
  // --- Corners (with loud failure logs) ---
  cornerTL = loadImage(
    "./assets/GYOPO.png",
    () => console.log("✅ loaded ./assets/GYOPO.png"),
    () => console.error("❌ failed ./assets/GYOPO.png (check folder name + file case)")
  );

  cornerBR = loadImage(
    "./assets/Lunar_New_Year.png",
    () => console.log("✅ loaded ./assets/Lunar_New_Year.png"),
    () => console.error("❌ failed ./assets/Lunar_New_Year.png (check folder name + file case)")
  );

  // --- Sprites (with loud failure logs) ---
  spriteImgs = SPRITE_FILES.map((path) =>
    loadImage(
      path,
      () => console.log("✅ loaded", path),
      () => console.error("❌ failed", path, "(case-sensitive on GitHub!)")
    )
  );
}

function setup() {
  // --- Canvas ---
  createCanvas(windowWidth, windowHeight);

  // --- Validate libraries ---
  if (typeof Matter === "undefined") {
    throw new Error("Matter.js not found. Check your <script> tag for matter.min.js");
  }
  if (typeof ml5 === "undefined") {
    throw new Error("ml5.js not found. Check your <script> tag for ml5.min.js");
  }

  // --- Bind Matter modules ---
  Engine = Matter.Engine;
  World = Matter.World;
  Bodies = Matter.Bodies;
  Body = Matter.Body;

  // --- Create Matter world ---
  engine = Engine.create();
  world = engine.world;
  world.gravity.y = CFG.gravityY;

  // --- Filter out any failed sprite loads ---
  spriteImgs = spriteImgs.filter((img) => img && img.width && img.height);

  // --- Create sprites (only if images loaded) ---
  sprites = [];
  if (spriteImgs.length === 0) {
    console.warn("⚠️ No sprite images loaded. Check /assets paths + capitalization on GitHub.");
  } else {
    for (let i = 0; i < CFG.spriteCount; i++) {
      const img = random(spriteImgs);
      const scale = random(CFG.spriteScaleMin, CFG.spriteScaleMax);
      const x = random(60, width - 60);
      const y = random(60, height - 60);
      sprites.push(new SpriteBody(x, y, img, scale));
    }
  }

  // --- Create pushers ---
  leftHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  rightHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  nosePusher = new PusherBody(0, 0, CFG.pusherRadiusNose);

  // --- Webcam ---
  const constraints = {
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };

  video = createCapture(constraints);
  video.size(windowWidth, windowHeight);
  video.elt.setAttribute("playsinline", "");
  video.elt.muted = true;
  video.hide();

  // Start pose model only after video metadata is ready
  video.elt.onloadedmetadata = () => {
    startPose();
  };
}

/**
 * Starts pose detection.
 * - If ml5.bodyPose exists, use it.
 * - Else if ml5.poseNet exists, use it.
 * This avoids the "ml5.bodyPose is not a function" crash.
 */
async function startPose() {
  try {
    // Ensure playback is running (some browsers need this)
    const playPromise = video.elt.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }

    // ---- BodyPose path (ml5 v1+) ----
    if (typeof ml5.bodyPose === "function") {
      poseSystem = "bodyPose";
      console.log("✅ Using ml5.bodyPose(video)");

      let maybe = ml5.bodyPose(video);
      poseModel = (maybe && typeof maybe.then === "function") ? await maybe : maybe;

      // ml5 bodyPose API: detectStart(video, callback)
      poseModel.detectStart(video, (results) => {
        // results should already be in your expected format
        poses = results || [];
      });

      console.log("✅ BodyPose started");
      return;
    }

    // ---- PoseNet path (ml5 v0.x) ----
    if (typeof ml5.poseNet === "function") {
      poseSystem = "poseNet";
      console.log("✅ BodyPose not available. Falling back to ml5.poseNet(video)");

      poseModel = ml5.poseNet(video, () => console.log("✅ PoseNet model loaded"));

      // PoseNet emits results with a different shape
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

    // ---- Neither available ----
    poseSystem = "none";
    throw new Error("Neither ml5.bodyPose nor ml5.poseNet is available. Check your ml5 <script> include.");
  } catch (err) {
    console.error("❌ Pose init failed:", err);
  }
}

function draw() {
  background(0);

  // --- Draw mirrored video (mirror-like feel) ---
  if (video) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();
  }

  // --- Step physics ---
  if (engine) Engine.update(engine);

  // --- Draw sprites ---
  for (const s of sprites) {
    s.show();
    s.bounceOffEdges();
  }

  // --- Update pushers ---
  updatePushersFromPose();

  // --- Debug pushers ---
  if (CFG.showDebugPushers) {
    leftHandPusher.showDebug();
    rightHandPusher.showDebug();
    nosePusher.showDebug();
  }

  // --- Corner overlays ---
  drawFixedCorners();

  // --- Debug HUD ---
  if (CFG.showDebugText) {
    push();
    fill(0, 255, 0);
    noStroke();
    textSize(16);
    text(`poseSystem: ${poseSystem}`, 20, 26);
    text(`poses: ${poses.length}`, 20, 46);
    text(`spritesLoaded: ${spriteImgs.length}`, 20, 66);
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
  image(
    cornerBR,
    width - brW - CORNER.padding,
    height - brH - CORNER.padding,
    brW,
    brH
  );
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
    if (kp.confidence < CFG.poseConfidence) continue;

    // Mirror X to match mirrored video draw
    const fx = width - kp.x;

    if (kp.name === "left_wrist") leftHandPusher.setPosition(fx, kp.y);
    else if (kp.name === "right_wrist") rightHandPusher.setPosition(fx, kp.y);
    else if (kp.name === "nose") nosePusher.setPosition(fx, kp.y);
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

    Body.setVelocity(this.body, {
      x: random(-1.2, 1.2),
      y: random(-1.2, 1.2),
    });

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



