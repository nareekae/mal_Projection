/*
  PNG SPRITES + POSE (BodyPose v1, PoseNet fallback) + MATTER.JS
  - Uses ABSOLUTE GitHub Pages asset paths: /mal_Projection/assets/...
  - Loud asset load logging (sprites + corners) so you can see exactly what fails
  - Forces TF backend to webgl (or cpu fallback) to reduce WebGPU adapter errors
  - Starts pose only after video metadata is ready
  - Mirrors video + mirrors pose X so pushers match what you see
  - Debug HUD: poseSystem, poses length, spritesLoaded
*/

let video;
let poseModel = null;
let poses = [];
let poseSystem = "none";

// ---------- ASSETS (GitHub Pages-safe absolute base) ----------
const ASSET_BASE = "/mal_Projection/assets/";

const SPRITE_FILES = [
  ASSET_BASE + "Mal.png",
  ASSET_BASE + "Mal1.png",
  ASSET_BASE + "Mal2.png",
  ASSET_BASE + "Mal3.png",
  ASSET_BASE + "Mal4.png",
  ASSET_BASE + "Mal5.png",
  ASSET_BASE + "Mal6.png",
  ASSET_BASE + "Mal7.png",
  ASSET_BASE + "Mal8.png",
  ASSET_BASE + "Mal9.png",
];

let spriteImgs = [];
let cornerTL, cornerBR;

// ---------- Matter.js ----------
let Engine, World, Bodies, Body;
let engine, world;

// ---------- Simulation ----------
let sprites = [];
let leftHandPusher, rightHandPusher, nosePusher;

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

// ---------- TF backend hardening ----------
async function forceTfBackend() {
  // ml5 bundles tfjs; on machines without WebGPU this reduces noisy failures
  if (typeof tf === "undefined") return;

  try {
    const current = tf.getBackend ? tf.getBackend() : "unknown";
    console.log("🔧 TF current backend:", current);

    // Force WebGL first
    await tf.setBackend("webgl");
    await tf.ready();
    console.log("✅ TF backend forced to webgl");
  } catch (e) {
    console.warn("⚠️ WebGL backend failed; trying cpu", e);
    try {
      await tf.setBackend("cpu");
      await tf.ready();
      console.log("✅ TF backend forced to cpu");
    } catch (e2) {
      console.warn("⚠️ CPU backend also failed", e2);
    }
  }
}

// ---------- Preload ----------
function preload() {
  // Corners (log success/fail loudly)
  cornerTL = loadImage(
    ASSET_BASE + "GYOPO.png",
    () => console.log("✅ loaded", ASSET_BASE + "GYOPO.png"),
    () => console.error("❌ failed", ASSET_BASE + "GYOPO.png", "(check exact name + folder)")
  );

  cornerBR = loadImage(
    ASSET_BASE + "Lunar_New_Year.png",
    () => console.log("✅ loaded", ASSET_BASE + "Lunar_New_Year.png"),
    () => console.error("❌ failed", ASSET_BASE + "Lunar_New_Year.png", "(check exact name + folder)")
  );

  // Sprites (log success/fail loudly)
  spriteImgs = SPRITE_FILES.map((path) =>
    loadImage(
      path,
      () => console.log("✅ loaded", path),
      () => console.error("❌ failed", path, "(case-sensitive on GitHub!)")
    )
  );
}

// ---------- Setup ----------
function setup() {
  createCanvas(windowWidth, windowHeight);

  // Path proof in console (copy/paste into browser to test)
  console.log("🔎 Asset base resolves to:", new URL(ASSET_BASE, window.location.href).href);
  console.log("🔎 Example sprite URL:", new URL(SPRITE_FILES[0], window.location.href).href);

  if (typeof Matter === "undefined") {
    throw new Error("Matter.js not found. Check your <script> tag for matter.min.js");
  }
  if (typeof ml5 === "undefined") {
    throw new Error("ml5.js not found. Check your <script> tag for ml5.min.js");
  }

  Engine = Matter.Engine;
  World = Matter.World;
  Bodies = Matter.Bodies;
  Body = Matter.Body;

  engine = Engine.create();
  world = engine.world;
  world.gravity.y = CFG.gravityY;

  // Filter out failed sprite loads
  spriteImgs = spriteImgs.filter((img) => img && img.width && img.height);

  // Create sprites
  sprites = [];
  if (spriteImgs.length === 0) {
    console.warn("⚠️ No sprite images loaded. Assets are still not reachable at:", ASSET_BASE);
  } else {
    for (let i = 0; i < CFG.spriteCount; i++) {
      const img = random(spriteImgs);
      const scale = random(CFG.spriteScaleMin, CFG.spriteScaleMax);
      const x = random(60, width - 60);
      const y = random(60, height - 60);
      sprites.push(new SpriteBody(x, y, img, scale));
    }
  }

  // Pushers (static bodies)
  leftHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  rightHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  nosePusher = new PusherBody(0, 0, CFG.pusherRadiusNose);

  // Webcam
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

  // Start pose once video is ready
  video.elt.onloadedmetadata = () => {
    startPose();
  };
}

// ---------- Pose startup (BodyPose or PoseNet fallback) ----------
async function startPose() {
  try {
    // Stabilize TF backend before model load
    await forceTfBackend();

    // Ensure video plays
    const playPromise = video.elt.play();
    if (playPromise && typeof playPromise.then === "function") {
      await playPromise;
    }

    // BodyPose (ml5 v1+)
    if (typeof ml5.bodyPose === "function") {
      poseSystem = "bodyPose";
      console.log("✅ Using ml5.bodyPose(video)");

      let maybe = ml5.bodyPose(video);
      poseModel = (maybe && typeof maybe.then === "function") ? await maybe : maybe;

      poseModel.detectStart(video, (results) => {
        poses = results || [];
        // One-time sample log (helps confirm keypoint shape)
        if (poses[0] && !poses.__loggedOnce) {
          console.log("🔎 first pose sample:", poses[0]);
          poses.__loggedOnce = true;
        }
      });

      console.log("✅ BodyPose started");
      return;
    }

    // PoseNet (ml5 v0.x fallback)
    if (typeof ml5.poseNet === "function") {
      poseSystem = "poseNet";
      console.log("✅ BodyPose unavailable. Using ml5.poseNet(video)");

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

        if (poses[0] && !poses.__loggedOnce) {
          console.log("🔎 first pose sample (PoseNet-normalized):", poses[0]);
          poses.__loggedOnce = true;
        }
      });

      console.log("✅ PoseNet started");
      return;
    }

    poseSystem = "none";
    throw new Error("Neither ml5.bodyPose nor ml5.poseNet exists. Check your ml5 script include.");
  } catch (err) {
    console.error("❌ Pose init failed:", err);
  }
}

// ---------- Draw ----------
function draw() {
  background(0);

  // Draw mirrored video
  if (video) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height);
    pop();
  }

  // Physics step
  if (engine) Engine.update(engine);

  // Render sprites
  for (const s of sprites) {
    s.show();
    s.bounceOffEdges();
  }

  // Update pushers from pose
  updatePushersFromPose();

  // Optional debug rings
  if (CFG.showDebugPushers) {
    leftHandPusher.showDebug();
    rightHandPusher.showDebug();
    nosePusher.showDebug();
  }

  // Corner overlays
  drawFixedCorners();

  // Debug HUD
  if (CFG.showDebugText) {
    push();
    fill(0, 255, 0);
    noStroke();
    textSize(16);
    text(`poseSystem: ${poseSystem}`, 20, 26);
    text(`poses: ${poses.length}`, 20, 46);
    text(`spritesLoaded: ${spriteImgs.length}`, 20, 66);

    if (spriteImgs.length === 0) {
      fill(255, 80, 80);
      textSize(18);
      text(`⚠️ Sprites not loading from: ${ASSET_BASE}`, 20, 95);
      text(`Try opening: ${SPRITE_FILES[0]}`, 20, 118);
    }
    pop();
  }
}

// ---------- Corners ----------
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

// ---------- Resize ----------
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (video) video.size(windowWidth, windowHeight);
}

// ---------- Pose → pushers ----------
function updatePushersFromPose() {
  if (!poses || poses.length === 0) return;

  const first = poses[0];
  if (!first || !first.keypoints) return;

  for (const kp of first.keypoints) {
    if (!kp) continue;

    // Some outputs use score instead of confidence; normalize
    const conf = (kp.confidence !== undefined) ? kp.confidence : (kp.score !== undefined ? kp.score : 0);
    if (conf < CFG.poseConfidence) continue;

    // BodyPose may use x/y directly or position.x/position.y; normalize
    const x = (kp.x !== undefined) ? kp.x : (kp.position?.x ?? null);
    const y = (kp.y !== undefined) ? kp.y : (kp.position?.y ?? null);
    if (x === null || y === null) continue;

    // Mirror X to match mirrored video draw
    const fx = width - x;

    // BodyPose uses "left_wrist"/"right_wrist"/"nose"
    // PoseNet uses "leftWrist"/"rightWrist"/"nose" (sometimes)
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
