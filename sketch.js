// ---------- ml5 bodyPose ----------
let video;
let bodyPose;
let poses = [];
let cameraReady = false;
let cameraError = "";


// ---------- PNG sprites ----------
const SPRITE_FILES = [
  "assets/Mal.png",
  "assets/Mal1.png",
  "assets/Mal2.png",
  "assets/Mal3.png",
  "assets/Mal4.png",
  "assets/Mal5.png",
  "assets/Mal6.png",
  "assets/Mal7.png",
  "assets/Mal8.png",
  "assets/Mal9.png",
];

let spriteImgs = [];
let cornerTL, cornerBR;

// ---------- Matter.js ----------
let Engine, World, Bodies, Body;
let engine, world;

// ---------- Simulation ----------
let sprites = [];
let leftHandPusher, rightHandPusher, nosePusher;

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
};

const CORNER = {
  padding: 50,
  tlScale: 0.7,
  brScale: 0.35,
};

function preload() {
  cornerTL = loadImage("assets/GYOPO.png");
  cornerBR = loadImage("assets/Lunar_New_Year.png");

  // Load sprites. preload() will block until they load (if paths are correct).
  spriteImgs = SPRITE_FILES.map((path) =>
    loadImage(
      path,
      () => {},
      () => console.error("Failed to load sprite image:", path)
    )
  );
}

async function setup() {
  // --- Canvas ---
  createCanvas(windowWidth, windowHeight);

  // --- Validate libraries early (clear errors) ---
  if (typeof Matter === "undefined") {
    throw new Error("Matter.js not found. Add the matter.js library.");
  }
  if (typeof ml5 === "undefined") {
    throw new Error("ml5.js not found. Add the ml5.js library.");
  }

  // --- Bind Matter modules now that Matter exists ---
  Engine = Matter.Engine;
  World  = Matter.World;
  Bodies = Matter.Bodies;
  Body   = Matter.Body;

  // --- Create Matter world ---
  engine = Engine.create();
  world  = engine.world;
  world.gravity.y = CFG.gravityY;

  // --- Filter out any failed loads (extra safety) ---
  spriteImgs = spriteImgs.filter(img => img && img.width && img.height);

  // --- Create sprites (only if images loaded) ---
  sprites = []; // reset (safe if hot-reloading)
  if (spriteImgs.length === 0) {
    console.warn("No sprite images loaded. Check your assets/ paths.");
  } else {
    for (let i = 0; i < CFG.spriteCount; i++) {
      const img = random(spriteImgs);
      const scale = random(CFG.spriteScaleMin, CFG.spriteScaleMax);
      const x = random(60, width - 60);
      const y = random(60, height - 60);
      sprites.push(new SpriteBody(x, y, img, scale));
    }
  }

  // --- Create pushers (need world to exist first) ---
  leftHandPusher  = new PusherBody(0, 0, CFG.pusherRadiusHand);
  rightHandPusher = new PusherBody(0, 0, CFG.pusherRadiusHand);
  nosePusher      = new PusherBody(0, 0, CFG.pusherRadiusNose);

  // --- Webcam + BodyPose ---
  // IMPORTANT: start BodyPose only once the camera stream is ready.
  // This avoids "black video" / no camera on hosted sites.
  video = createCapture(VIDEO, { flipped: true }, async () => {
    try {
      // Size capture to match canvas
      video.size(windowWidth, windowHeight);

      // iOS / mobile friendliness + autoplay friendliness
      video.elt.setAttribute("playsinline", "");
      video.elt.muted = true;

      // Force playback (some browsers need this)
      const playPromise = video.elt.play();
      if (playPromise && typeof playPromise.then === "function") {
        await playPromise;
      }

      // Hide the DOM video element; we’ll draw it to canvas with image(video, ...)
      video.hide();

      // Load BodyPose model (supports both sync + async constructor)
      const maybeModel = ml5.bodyPose({ flipped: true });
      bodyPose = (maybeModel && typeof maybeModel.then === "function")
        ? await maybeModel
        : maybeModel;

      // Start pose detection
      bodyPose.detectStart(video, gotPoses);

      console.log("✅ Camera + BodyPose started");
    } catch (err) {
      console.error("❌ Camera/BodyPose init failed:", err);

      // Helpful hint if permissions are blocked
      console.warn(
        "If you're on GitHub Pages, make sure camera permission is set to Allow for this site (lock icon in the address bar)."
      );
    }
  });

  // (Optional) If you want to see the DOM video briefly for debugging,
  // comment out video.hide() above.
}

function draw() {
  background(0);

  // Only draw video if it exists
  if (video) image(video, 0, 0, width, height);

  // Only step physics if engine exists
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

function gotPoses(results) {
  poses = results;
}

function updatePushersFromPose() {
  if (!poses || poses.length === 0) return;
  const pose = poses[0];
  if (!pose.keypoints) return;

  for (const kp of pose.keypoints) {
    if (kp.confidence < CFG.poseConfidence) continue;

    if (kp.name === "left_wrist") leftHandPusher.setPosition(kp.x, kp.y);
    else if (kp.name === "right_wrist") rightHandPusher.setPosition(kp.x, kp.y);
    else if (kp.name === "nose") nosePusher.setPosition(kp.x, kp.y);
  }
}

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

