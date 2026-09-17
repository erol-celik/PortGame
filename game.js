const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const minimapCanvas = document.getElementById("minimapCanvas");
const minimapCtx = minimapCanvas.getContext("2d");

// -------------------------
// HTML Overlay References
// -------------------------
const ui = {
  taskPanelList: document.querySelector("#task-panel ul"),
  safetyPanelList: document.querySelector("#safety-panel ul"),
  scoreValue: document.getElementById("score-value"),
  shiftClockValue: document.getElementById("shift-clock-value"),
  vehicleSpeedValue: document.getElementById("vehicle-speed-value"),
  vehicleLoadValue: document.getElementById("vehicle-load-value"),
  vehicleFuelValue: document.getElementById("vehicle-fuel-value"),
  speedRuleStatus: document.getElementById("speed-rule-status"),
  hornRuleStatus: document.getElementById("horn-rule-status"),
  collisionRuleStatus: document.getElementById("collision-rule-status")
};

// Add a live violations row to the safety panel.
const violationsRow = document.createElement("li");
violationsRow.id = "violations-row";
violationsRow.textContent = "Safety Violations: 0";
ui.safetyPanelList.appendChild(violationsRow);

// -------------------------
// Core World / State
// -------------------------
const world = {
  width: 1920,
  height: 1080
};

const GAME_STATE = {
  RUNNING: "running",
  GAME_OVER: "game_over"
};

const keys = {
  w: false,
  a: false,
  s: false,
  d: false
};

const actions = {
  toggleContainer: false,
  honk: false
};

const pickupRange = 46;
const nearMissRadius = 50;
const nearMissCooldownMs = 1200;
const honkSafetyWindowMs = 1200;
const hornHitRadius = 140;
const speedLimitKmh = 30;
const RESTART_DOUBLE_TAP_MS = 800;
const REEFER_DURATION_MS = 20000;

const CLOCK_START_HOUR = 8;
const CLOCK_START_MINUTE = 0;
const CLOCK_MINUTES_PER_REAL_SECOND = 0.25;

let gameState = GAME_STATE.RUNNING;
let lastSpaceTapAt = -Infinity;
let safetyViolations = 0;
let lastHonkAt = -Infinity;
let efficiencyScore = 50;
let missionStartMs = performance.now();
let lastFrameMs = performance.now();
let feedbackUntil = 0;
let feedbackText = "";
let feedbackColor = "#49ff7d";
let pendingNextTaskAt = -1;
let gameOverMessage = "GAME OVER - ACCIDENT";
let reeferDeadlineMs = null;
let globalTimeLeft = 120;
let shiftTimeHours = 16.0;

const background = new Image();
background.src = "background.png";
background.onload = () => {
  // World is locked to 1920x1080 — do not override from image.
  zones = buildZones();
  buildings = buildBuildings();
  setupShip();
  spawnParkedTrucks();
  updateCamera();
};
background.onerror = () => {
  // Fallback path if image is stored in sources/.
  if (!background.src.includes("sources/background.png")) {
    background.src = "sources/background.png";
  }
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resizeCanvas() {
  canvas.width = 1920;
  canvas.height = 1080;
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.display = "block";
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// -------------------------
// Real Audio Files
// -------------------------
const hornAudio = new Audio("sources/horn.mp3");
hornAudio.preload = "auto";
hornAudio.loop = false;
hornAudio.volume = 0.95;

const reverseAudio = new Audio("sources/reverse.mp3");
reverseAudio.preload = "auto";
reverseAudio.loop = true;
reverseAudio.volume = 0.45;

let audioUnlocked = false;

function unlockAudioOnFirstInteraction() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  const prime = (audio) => {
    const oldMuted = audio.muted;
    audio.muted = true;
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = oldMuted;
      }).catch(() => {
        audio.muted = oldMuted;
      });
    }
  };

  prime(hornAudio);
  prime(reverseAudio);
}

function playHorn() {
  if (!audioUnlocked) return;
  // Cooldown: do not overlap or restart while still playing.
  if (!hornAudio.paused) return;
  hornAudio.currentTime = 0;
  hornAudio.play().catch(() => { });
}

function stopReverseAudio() {
  if (!reverseAudio.paused) reverseAudio.pause();
  reverseAudio.currentTime = 0;
}

function updateReverseAudio() {
  if (!audioUnlocked) return;
  const reversing = player.speed < -0.05;
  if (reversing) {
    if (reverseAudio.paused) {
      reverseAudio.currentTime = 0;
      reverseAudio.play().catch(() => { });
    }
  } else {
    stopReverseAudio();
  }
}

// -------------------------
// Entities
// -------------------------
class Player {
  constructor(x, y) {
    this.spawnX = x;
    this.spawnY = y;
    this.x = x;
    this.y = y;
    this.width = 40;
    this.height = 20;
    this.angle = 0;
    this.speed = 0;

    this.baseMaxForwardSpeed = 1.875;
    this.baseMaxReverseSpeed = -0.75;
    this.acceleration = 0.1;
    this.friction = 0.09;
    this.baseTurnSpeed = 0.032;

    this.loadedSpeedMultiplier = 0.7;
    this.loadedTurnMultiplier = 0.75;
    this.carryingContainer = null;

    this.fuel = 100;
    this.fuelConsumptionRate = 0.5;
  }

  get isLoaded() {
    return this.carryingContainer !== null;
  }

  get maxForwardSpeed() {
    return this.baseMaxForwardSpeed * (this.isLoaded ? this.loadedSpeedMultiplier : 1);
  }

  get maxReverseSpeed() {
    return this.baseMaxReverseSpeed * (this.isLoaded ? this.loadedSpeedMultiplier : 1);
  }

  get turnSpeed() {
    return this.baseTurnSpeed * (this.isLoaded ? this.loadedTurnMultiplier : 1);
  }

  reset() {
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.angle = 0;
    this.speed = 0;
    this.carryingContainer = null;
    this.fuel = 100;
  }

  update(input) {
    const previousX = this.x;
    const previousY = this.y;

    if (input.w) this.speed += this.acceleration;
    if (input.s) this.speed -= this.acceleration;

    this.speed = clamp(this.speed, this.maxReverseSpeed, this.maxForwardSpeed);

    // Only steer while moving.
    if (this.speed !== 0) {
      const steeringDirection = this.speed > 0 ? 1 : -1;
      if (input.a) this.angle -= this.turnSpeed * steeringDirection;
      if (input.d) this.angle += this.turnSpeed * steeringDirection;
    }

    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    if (this.speed > 0) {
      this.speed = Math.max(0, this.speed - this.friction);
    } else if (this.speed < 0) {
      this.speed = Math.min(0, this.speed + this.friction);
    }

    this.x = clamp(this.x, this.width / 2, world.width - this.width / 2);
    this.y = clamp(this.y, this.height / 2, world.height - this.height / 2);

    // --- Exhaust Emission Logic ---
    if (Math.abs(this.speed) > 0.5 && Math.random() < 0.3) {
      // Calculate the exact back center of the vehicle
      const backOffset = this.width / 2;
      const exhaustX = this.x - Math.cos(this.angle) * backOffset;
      const exhaustY = this.y - Math.sin(this.angle) * backOffset;

      exhaustParticles.push(new ExhaustParticle(exhaustX, exhaustY, this.angle));
    }

    // Static containers, buildings, parked trucks, and water are solid obstacles.
    const playerRect = {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      width: this.width,
      height: this.height
    };

    let collision = false;
    for (const obstacle of staticContainers) {
      if (rectsOverlap(playerRect, obstacle.getRect())) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      for (const b of buildings) {
        if (rectsOverlap(playerRect, b)) {
          collision = true;
          break;
        }
      }
    }
    if (!collision) {
      for (const pt of parkedTrucks) {
        if (rectsOverlap(playerRect, pt.getRect())) {
          collision = true;
          break;
        }
      }
    }


    if (!collision) {
      const waterZone = { x: world.width - 300, y: 0, width: 300, height: world.height };
      if (rectsOverlap(playerRect, waterZone)) {
        collision = true;
      }
    }

    if (collision) {
      this.x = previousX;
      this.y = previousY;
      this.speed = 0;
    }

    if (this.carryingContainer) {
      this.carryingContainer.x = this.x;
      this.carryingContainer.y = this.y;
    }
  }

  draw(context, cam) {
    context.save();
    context.translate(this.x - cam.x, this.y - cam.y);
    context.rotate(this.angle);

    const hw = this.width / 2;   // 20
    const hh = this.height / 2;  // 10

    // --- Layer 1: Wheels (4 black rectangles protruding from sides) ---
    context.fillStyle = "#111";
    const ww = 7, wh = 5;
    // Front-right wheel
    context.fillRect(hw - ww - 3, hh - 1, ww, wh);
    // Rear-right wheel
    context.fillRect(-hw + 3, hh - 1, ww, wh);
    // Front-left wheel
    context.fillRect(hw - ww - 3, -hh - wh + 1, ww, wh);
    // Rear-left wheel
    context.fillRect(-hw + 3, -hh - wh + 1, ww, wh);

    // --- Layer 2: Main body (yellow) ---
    context.fillStyle = "#ffde21";
    context.fillRect(-hw, -hh, this.width, this.height);
    // Subtle body outline
    context.strokeStyle = "rgba(0,0,0,0.3)";
    context.lineWidth = 0.8;
    context.strokeRect(-hw, -hh, this.width, this.height);

    // --- Layer 3: Cabin (dark blue glass, offset to rear-left) ---
    context.fillStyle = "#1f2e4d";
    const cabW = 10, cabH = 12;
    context.fillRect(-hw + 2, -cabH / 2, cabW, cabH);
    // Glass highlight
    context.fillStyle = "rgba(120,180,230,0.35)";
    context.fillRect(-hw + 3, -cabH / 2 + 1, cabW - 2, cabH - 2);

    // --- Layer 4: Boom (thick dark gray arm from center to front) ---
    context.fillStyle = "#3a3a3a";
    const boomH = 4;
    context.fillRect(0, -boomH / 2, hw - 2, boomH);
    // Boom outline
    context.strokeStyle = "rgba(0,0,0,0.25)";
    context.lineWidth = 0.6;
    context.strokeRect(0, -boomH / 2, hw - 2, boomH);

    // --- Layer 5: Spreader (wide thin black bar at boom tip) ---
    context.fillStyle = "#111";
    const spW = 4, spH = 14;
    context.fillRect(hw - spW - 1, -spH / 2, spW, spH);

    // --- Carried container drawn ON TOP of the spreader ---
    if (this.carryingContainer) {
      context.save();
      context.translate(-20, -8);
      drawContainerGraphics(context, 40, 16, this.carryingContainer.color, this.carryingContainer.color === "#800080");
      context.restore();
    }

    context.restore();
  }
}

// -------------------------
// Shared Container Drawing
// -------------------------
function drawContainerGraphics(ctx, width, height, color, isOOG = false, label = "") {
  // Step 1 (Base): Fill the rectangle with the color.
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

  // Step 2 (Corrugated Texture):
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1;
  const numLines = 5;
  const spacing = width / (numLines + 1);
  for (let i = 1; i <= numLines; i++) {
    ctx.beginPath();
    ctx.moveTo(i * spacing, 1);
    ctx.lineTo(i * spacing, height - 1);
    ctx.stroke();
  }

  // Step 3 (OOG/Purple):
  if (isOOG || color === "#800080") {
    // dark gray inner rectangle (open top)
    ctx.fillStyle = "#333";
    ctx.fillRect(2, 2, width - 4, height - 4);
    // thick light-gray shape extending slightly beyond
    ctx.fillStyle = "#ccc";
    ctx.fillRect(-2, height / 2 - 4, width + 4, 8);
    // extra machinery detail
    ctx.fillStyle = "#999";
    ctx.fillRect(width / 2 - 6, height / 2 - 4, 12, 8);
  }

  // Step 4 (Labels/Icons):
  let textToDraw = label;
  if (!textToDraw) {
    if (color === "#ff2b2b" || color === "#8b0000") textToDraw = "⚠️";
    if (color === "#ffffff" || color === "#bdf1ff") textToDraw = "❄️";
  }

  if (textToDraw) {
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111";
    ctx.fillText(textToDraw, width / 2, height / 2);
  }

  // Thin black border
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);
}

class Container {
  constructor(x, y, color = "#2a66ff") {
    this.x = x;
    this.y = y;
    this.width = 40;
    this.height = 16;
    this.color = color;
    this.isAttached = false;
    this.active = true;
  }

  draw(context, cam) {
    if (!this.active || this.isAttached) return;
    context.save();
    context.translate(this.x - this.width / 2 - cam.x, this.y - this.height / 2 - cam.y);
    drawContainerGraphics(context, this.width, this.height, this.color, this.color === "#800080");
    context.restore();
  }
}

class StaticContainer {
  constructor(x, y, color, label = "") {
    this.x = x;
    this.y = y;
    this.width = 40;
    this.height = 16;
    this.color = color;
    this.label = label;
  }

  getRect() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      width: this.width,
      height: this.height
    };
  }

  draw(context, cam) {
    context.save();
    context.translate(this.x - this.width / 2 - cam.x, this.y - this.height / 2 - cam.y);
    drawContainerGraphics(context, this.width, this.height, this.color, false, this.label);
    context.restore();
  }
}

class TrafficCone {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = 5;
  }

  update(dt) {
    // Simple friction
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.9;
    this.vy *= 0.9;
  }

  draw(context, cam) {
    const cx = this.x - cam.x;
    const cy = this.y - cam.y;
    context.save();

    // Orange triangle
    context.fillStyle = "#ff6600";
    context.beginPath();
    context.moveTo(cx, cy - this.radius);
    context.lineTo(cx + this.radius, cy + this.radius);
    context.lineTo(cx - this.radius, cy + this.radius);
    context.closePath();
    context.fill();

    // Reflective white stripe (small polygon in the middle)
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.moveTo(cx, cy - this.radius * 0.2);
    context.lineTo(cx + this.radius * 0.6, cy + this.radius * 0.4);
    context.lineTo(cx - this.radius * 0.6, cy + this.radius * 0.4);
    context.closePath();
    context.fill();

    context.restore();
  }
}

class Pedestrian {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 9.5;
    this.direction = Math.random() * Math.PI * 2;
    this.walkSpeed = 0.35;
    this.sprintMultiplier = 2;
    this.turnTimer = 0;
    this.sprintUntil = 0;
    this.lastViolationAt = -Infinity;
  }

  update(dt, nowMs) {
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.direction += (Math.random() - 0.5) * 1.2;
      this.turnTimer = 1 + Math.random() * 2.2;
    }

    const isSprinting = nowMs < this.sprintUntil;
    const speed = this.walkSpeed * (isSprinting ? this.sprintMultiplier : 1);
    const movement = speed * dt * 60;
    this.x += Math.cos(this.direction) * movement;
    this.y += Math.sin(this.direction) * movement;

    const waterBoundary = world.width - 320;
    const minX = 300 + this.radius; // Don't go on the road (x < 300)
    const minY = this.radius;
    const maxX = Math.min(world.width - this.radius, waterBoundary);
    const maxY = world.height - this.radius;

    if (this.x < minX || this.x > maxX) {
      this.x = clamp(this.x, minX, maxX);
      this.direction = Math.PI - this.direction;
    }
    if (this.y < minY || this.y > maxY) {
      this.y = clamp(this.y, minY, maxY);
      this.direction = -this.direction;
    }
  }

  triggerSprint(nowMs) {
    const sprintDuration = 2000 + Math.random() * 1000;
    this.sprintUntil = Math.max(this.sprintUntil, nowMs + sprintDuration);
  }

  draw(context, cam) {
    context.save();
    context.translate(this.x - cam.x, this.y - cam.y);
    context.rotate(this.direction);

    // Safety vest/shoulders (orange horizontal ellipse)
    context.fillStyle = "#ff6600";
    context.beginPath();
    // Use ellipse: x, y, radiusX, radiusY, rotation, startAngle, endAngle
    context.ellipse(0, 0, 11, 6.3, 0, 0, Math.PI * 2);
    context.fill();

    // Hard hat (yellow circle)
    context.fillStyle = "#ffd700";
    context.beginPath();
    context.arc(0, 0, 7.1, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }
}

class Truck {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 80;
    this.height = 30;
    this.cabinWidth = 24;
    this.active = true;
    this.departing = false;
    this.alpha = 1.0;
  }


  getRect() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      width: this.width,
      height: this.height
    };
  }

  getTrailerRect() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      width: this.width - this.cabinWidth,
      height: this.height
    };
  }

  draw(context, cam) {
    if (!this.active) return;
    const left = this.x - this.width / 2 - cam.x;
    const top = this.y - this.height / 2 - cam.y;
    const tw = this.width - this.cabinWidth;  // trailer width
    const h = this.height;

    context.save();
    context.globalAlpha = this.alpha;

    // --- Trailer wheels (3 pairs along bottom & top edges) ---
    context.fillStyle = "#111";
    const tireW = 7, tireH = 6;
    for (let i = 0; i < 3; i++) {
      const tx = left + 8 + i * ((tw - 20) / 2);
      context.fillRect(tx, top + h - 1, tireW, tireH);       // bottom
      context.fillRect(tx, top - tireH + 1, tireW, tireH);    // top
    }

    // --- Trailer (silver/white with bold stroke) ---
    context.fillStyle = "#e0e0e0";
    context.fillRect(left, top, tw, h);
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(left, top, tw, h);

    // Inner cross-beams
    context.lineWidth = 1;
    context.strokeStyle = "#6e6e6e";
    // Horizontal center line
    context.beginPath();
    context.moveTo(left + 2, top + h / 2);
    context.lineTo(left + tw - 2, top + h / 2);
    context.stroke();
    // Vertical cross lines (2 dividers)
    for (let i = 1; i <= 2; i++) {
      const cx = left + (tw / 3) * i;
      context.beginPath();
      context.moveTo(cx, top + 2);
      context.lineTo(cx, top + h - 2);
      context.stroke();
    }

    // --- Cabin wheels (1 pair) ---
    context.fillStyle = "#111";
    const cabX = left + tw;
    context.fillRect(cabX + 4, top + h - 1, tireW, tireH);    // bottom
    context.fillRect(cabX + 4, top - tireH + 1, tireW, tireH); // top

    // --- Cabin body ---
    context.fillStyle = "#ff0000";
    context.fillRect(cabX, top, this.cabinWidth, h);
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(cabX, top, this.cabinWidth, h);

    // --- Windshield (light blue rectangle on cabin) ---
    context.fillStyle = "rgba(130,195,240,0.6)";
    context.fillRect(cabX + 4, top + 4, this.cabinWidth - 8, h - 8);

    // --- Headlights (two small yellow circles at the very front) ---
    context.fillStyle = "#ffe066";
    const hlR = 3;
    const hlX = cabX + this.cabinWidth;
    context.beginPath();
    context.arc(hlX, top + 5, hlR, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(hlX, top + h - 5, hlR, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }
}

class Seagull {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.baseY = y; // Anchor point for stable sine wave movement

    // Slow speed between 0.5 and 1.5
    this.speed = 0.5 + Math.random() * 1.0;

    // Fly left or right randomly
    this.direction = Math.random() < 0.5 ? 1 : -1;

    // Desynchronize wing flapping so they don't all flap perfectly together
    this.wingOffset = Math.random() * 100;
  }

  update(dt) {
    // 1. Move steadily across the screen
    // Multiplied by 60 to normalize to roughly 60fps frame rates
    this.x += this.speed * this.direction * (dt * 60);

    // 2. Organic vertical sine wave movement
    this.y = this.baseY + Math.sin(Date.now() / 300 + this.x * 0.05) * 10;

    // 3. Reset position if it flies off canvas
    if (this.direction === 1 && this.x > world.width + 50) {
      this.x = -50;
      this.baseY = Math.random() * world.height; // Pick a new random height
    } else if (this.direction === -1 && this.x < -50) {
      this.x = world.width + 50;
      this.baseY = Math.random() * world.height;
    }
  }

  draw(context, cam) {
    const gx = this.x - cam.x;
    const gy = this.y - cam.y;

    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.85)"; // White with slight opacity
    context.lineWidth = 2;
    context.lineCap = "round";

    // Wing flapping math
    const flap = Math.sin(Date.now() / 150 + this.wingOffset);
    const wingSpan = 12;
    const wingHeight = flap * 6; // Flap goes up and down

    context.beginPath();
    // Left wing
    context.moveTo(gx - wingSpan, gy - wingHeight);
    context.quadraticCurveTo(gx - wingSpan / 2, gy + 2, gx, gy);
    // Right wing
    context.quadraticCurveTo(gx + wingSpan / 2, gy + 2, gx + wingSpan, gy - wingHeight);
    context.stroke();

    context.restore();
  }
}


// --- Particle System ---
const exhaustParticles = [];

class ExhaustParticle {
  constructor(x, y, vehicleAngle) {
    this.x = x;
    this.y = y;
    this.maxLife = 30 + Math.random() * 30; // Lasts 30 to 60 frames
    this.life = this.maxLife;
    this.size = 2 + Math.random() * 3;
    this.alpha = 0.5 + Math.random() * 0.3;

    // Give it a slight spread so it billows out naturally
    const spread = (Math.random() - 0.5) * 0.8;
    // Push away from the vehicle (opposite to vehicle angle)
    const pushSpeed = 0.5 + Math.random() * 1.0;

    this.vx = Math.cos(vehicleAngle + Math.PI + spread) * pushSpeed;
    this.vy = Math.sin(vehicleAngle + Math.PI + spread) * pushSpeed;
  }

  update(dt) {
    this.life -= 1;
    this.x += this.vx;
    this.y += this.vy;
    this.size += 0.15; // Expanding smoke

    // Smoothly fade out based on remaining life
    this.alpha = Math.max(0, this.alpha - (1 / this.maxLife));
  }

  draw(context, cam) {
    context.save();
    context.globalAlpha = this.alpha;
    context.fillStyle = "#555555"; // Dark gray smoke
    context.beginPath();
    context.arc(this.x - cam.x, this.y - cam.y, this.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}
class ContainerBlock {
  constructor(x, y, cols, rows) {
    this.x = x;
    this.y = y;
    this.cols = cols;
    this.rows = rows;

    // Strict physical dimensions
    this.miniWidth = 20;
    this.miniHeight = 40;

    // The physical hitbox dynamically perfectly matches the grid
    this.width = this.cols * this.miniWidth;
    this.height = this.rows * this.miniHeight;
    this.type = "containerBlock";

    const colors = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22", "#ecf0f1", "#95a5a6"];
    this.containers = [];

    // Pre-generate grid colors
    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        this.containers.push({
          col: col,
          row: row,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }
  }

  draw(context, cam) {
    context.save();
    for (const c of this.containers) {
      context.fillStyle = c.color;

      // Zero margins, zero gaps. Perfectly flush.
      const drawX = this.x - cam.x + (c.col * this.miniWidth);
      const drawY = this.y - cam.y + (c.row * this.miniHeight);

      context.fillRect(drawX, drawY, this.miniWidth, this.miniHeight);

      // Bold black outline for each container
      context.strokeStyle = "#000000"; // Solid black
      context.lineWidth = 2; // Increased line width for a bold look
      context.strokeRect(drawX, drawY, this.miniWidth, this.miniHeight);
    }
    context.restore();
  }
}

class TrafficVehicle {
  constructor(x, direction) {
    this.width = 28;
    this.height = 70;
    this.direction = direction; // 1 for Down, -1 for Up
    this.x = x;

    if (this.direction === 1) {
      this.y = -this.height;
    } else {
      this.y = world.height + this.height;
    }

    this.speed = 120; // STRICT CONSTANT value
    const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#ecf0f1", "#34495e"];
    this.color = colors[Math.floor(Math.random() * colors.length)];
  }

  getRect() {
    return {
      x: this.x - this.width / 2,
      y: this.y - this.height / 2,
      width: this.width,
      height: this.height
    };
  }

  update(dt) {
    this.y += this.direction * this.speed * dt;
  }

  draw(context, cam) {
    const left = this.x - this.width / 2 - cam.x;
    const top = this.y - this.height / 2 - cam.y;

    context.save();

    // Wheels
    context.fillStyle = "#111";
    const tireW = 5, tireH = 8;
    context.fillRect(left - tireW, top + 10, tireW, tireH);
    context.fillRect(left + this.width, top + 10, tireW, tireH);
    context.fillRect(left - tireW, top + this.height - 18, tireW, tireH);
    context.fillRect(left + this.width, top + this.height - 18, tireW, tireH);

    // Body
    context.fillStyle = this.color;
    context.fillRect(left, top, this.width, this.height);
    context.strokeStyle = "#000";
    context.lineWidth = 1.5;
    context.strokeRect(left, top, this.width, this.height);

    // Cabin/Window
    context.fillStyle = "rgba(130, 195, 240, 0.7)";
    if (this.direction === 1) {
      context.fillRect(left + 4, top + this.height - 15, this.width - 8, 10);
      context.fillStyle = "#ffdd00";
      context.beginPath();
      context.arc(left + 6, top + this.height, 3, 0, Math.PI * 2);
      context.arc(left + this.width - 6, top + this.height, 3, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillRect(left + 4, top + 5, this.width - 8, 10);
      context.fillStyle = "#ffdd00";
      context.beginPath();
      context.arc(left + 6, top, 3, 0, Math.PI * 2);
      context.arc(left + this.width - 6, top, 3, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}

class Helicopter {
  constructor(cx, cy) {
    this.patrolCenter = { x: cx, y: cy };
    this.patrolRadius = 450;
    this.patrolAngle = 0;

    // Start position
    this.x = cx + this.patrolRadius;
    this.y = cy;

    // Movement and animation speeds
    this.speed = 0.25; // Radians per second (controls patrol speed)
    this.rotorAngle = 0;
    this.rotorSpeed = 18; // Radians per second (fast spin!)
  }

  update(dt) {
    // Circular patrol logic
    this.patrolAngle += this.speed * dt;
    this.x = this.patrolCenter.x + Math.cos(this.patrolAngle) * this.patrolRadius;
    this.y = this.patrolCenter.y + Math.sin(this.patrolAngle) * this.patrolRadius;

    // Orient the helicopter to face its travel direction
    this.angle = this.patrolAngle + Math.PI / 2;

    // Spin the main rotor continuously
    this.rotorAngle += this.rotorSpeed * dt;
  }

  draw(context, cam) {
    // --- 1. High-Altitude Shadow ---
    context.save();
    // Offset by +40x and +40y to create the illusion of height
    const sx = this.x - cam.x + 40;
    const sy = this.y - cam.y + 40;
    context.translate(sx, sy);
    context.rotate(this.angle);

    context.fillStyle = "rgba(0, 0, 0, 0.35)"; // Semi-transparent black

    // Shadow Body
    context.beginPath();
    context.ellipse(0, 0, 12, 32, 0, 0, Math.PI * 2);
    context.fill();

    // Shadow Rotor
    context.rotate(this.rotorAngle);
    context.fillRect(-2, -45, 4, 90);
    context.restore();

    // --- 2. Helicopter Body ---
    context.save();
    const hx = this.x - cam.x;
    const hy = this.y - cam.y;
    context.translate(hx, hy);
    context.rotate(this.angle);

    // Tail Boom
    context.fillStyle = "#1a1a2e";
    context.fillRect(-3, 20, 6, 30);

    // Tail Rotor
    context.fillStyle = "#95a5a6";
    context.fillRect(-8, 45, 16, 3);

    // Main Fuselage (Sleek Dark Blue)
    context.fillStyle = "#0f3460";
    context.beginPath();
    context.ellipse(0, 0, 14, 28, 0, 0, Math.PI * 2);
    context.fill();

    // Cockpit Glass
    context.fillStyle = "#82c3f0";
    context.beginPath();
    context.ellipse(0, -14, 10, 8, 0, 0, Math.PI * 2);
    context.fill();

    // Main Rotor Blade
    context.rotate(this.rotorAngle);
    context.fillStyle = "#222";
    context.fillRect(-3, -48, 6, 96);
    // Rotor Tips (Visual blur effect)
    context.fillStyle = "#ecf0f1";
    context.fillRect(-3, -48, 6, 4);
    context.fillRect(-3, 44, 6, 4);

    // Rotor Center Hub
    context.beginPath();
    context.arc(0, 0, 5, 0, Math.PI * 2);
    context.fillStyle = "#111";
    context.fill();

    context.restore();
  }
}

// -------------------------
// Zones & Tasks
// -------------------------
function generateProceduralBlocks(zone, count) {
  const blocks = [];
  const minGap = 60;
  const maxAttempts = 500;

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;

      const rows = randomInt(1, 2);
      const cols = randomInt(3, 6);

      // Visually horizontal: blockWidth > blockHeight
      // cols * 20 > rows * 40 => cols > 2 * rows
      if (cols <= 2 * rows) continue;

      const bw = cols * 20;
      const bh = rows * 40;

      // Stay inside zone with small margin
      const margin = 10;
      if (zone.width < bw + 2 * margin || zone.height < bh + 2 * margin) continue;

      const x = zone.x + margin + Math.random() * (zone.width - bw - 2 * margin);
      const y = zone.y + margin + Math.random() * (zone.height - bh - 2 * margin);

      const newBlock = new ContainerBlock(x, y, cols, rows);

      // Check for overlaps with 60px gap between blocks
      let collision = false;
      for (const existing of blocks) {
        const expandedRect = {
          x: existing.x - minGap,
          y: existing.y - minGap,
          width: existing.width + 2 * minGap,
          height: existing.height + 2 * minGap
        };
        if (rectsOverlap(newBlock, expandedRect)) {
          collision = true;
          break;
        }
      }

      if (!collision) {
        blocks.push(newBlock);
        break;
      }
    }
  }
  return blocks;
}

function buildBuildings() {
  const b = [
    { x: 430, y: 100, width: 180, height: 140, type: "warehouse" },
    { x: 430, y: 250, width: 80, height: 60, type: "office" },
    { x: 950, y: 900, radius: 45, type: "helipad" }
  ];

  // Procedural Container Blocks for CYZone, ReeferZone, and IMDGZone
  const cyZone = getZoneByName("CYZone");
  if (cyZone) b.push(...generateProceduralBlocks(cyZone, 6));

  const reeferZone = getZoneByName("ReeferZone");
  if (reeferZone) b.push(...generateProceduralBlocks(reeferZone, 3));

  const imdgZone = getZoneByName("IMDGZone");
  if (imdgZone) b.push(...generateProceduralBlocks(imdgZone, 3));

  return b;
}

function buildZones() {
  return [
    {
      name: "ReeferZone",
      x: 750,
      y: 75,
      width: 350,
      height: 250,
      color: "rgba(0, 100, 255, 0.2)"
    },
    {
      name: "IMDGZone",
      x: 1175,
      y: 100,
      width: 350,
      height: 250,
      color: "rgba(255, 0, 0, 0.2)"
    },
    {
      name: "CYZone",
      x: 750,
      y: 450,
      width: 700,
      height: 320,
      color: "rgba(0, 255, 0, 0.2)"
    },
    {
      name: "GateZone",
      x: 1150,
      y: 850,
      width: 280,
      height: 200,
      color: "rgba(255, 165, 0, 0.2)"
    },
    {
      name: "FuelStation",
      x: 450,
      y: 850,
      width: 200,
      height: 150,
      color: "rgba(255, 190, 0, 0.25)"
    },
    {
      name: "ParkingZone",
      x: 400,
      y: 450,
      width: 200,
      height: 175,
      color: "rgba(255, 255, 255, 0.1)"
    }
  ];
}

const taskTypes = [
  { type: "Reefer", target: "ReeferZone", color: "#ffffff", colorLabel: "WHITE" },
  { type: "IMDG", target: "IMDGZone", color: "#ff2b2b", colorLabel: "RED" },
  { type: "Export", target: "GateZone", color: "#2a66ff", colorLabel: "BLUE" },
  { type: "OOG", target: "CYZone", color: "#800080", colorLabel: "PURPLE" }
];

function getZoneByName(name) {
  return zones.find((z) => z.name === name);
}

function pointInsideZone(x, y, zone) {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

function containerInsideZone(container, zone) {
  const left = container.x - container.width / 2;
  const right = container.x + container.width / 2;
  const top = container.y - container.height / 2;
  const bottom = container.y + container.height / 2;
  return (
    left >= zone.x &&
    right <= zone.x + zone.width &&
    top >= zone.y &&
    bottom <= zone.y + zone.height
  );
}

function isValidSpawn(x, y, width, height) {
  const rect = { x: x - width / 2, y: y - height / 2, width, height };

  // Block spawning on the left highway
  if (rect.x < 300) return false;

  // Check buildings
  for (const b of buildings) {
    if (rectsOverlap(rect, b)) return false;
  }

  // Check Water zone
  const waterZone = { x: world.width - 300, y: 0, width: 300, height: world.height };
  if (rectsOverlap(rect, waterZone)) return false;

  // Check parked trucks
  for (const pt of parkedTrucks) {
    if (rectsOverlap(rect, pt.getRect())) return false;
  }

  // Check static containers
  for (const sc of staticContainers) {
    if (rectsOverlap(rect, sc.getRect())) return false;
  }

  return true;
}

function randomSpawnOutsideZone(zone) {
  for (let i = 0; i < 500; i += 1) {
    const x = 80 + Math.random() * Math.max(1, world.width - 160);
    const y = 80 + Math.random() * Math.max(1, world.height - 160);
    if (!pointInsideZone(x, y, zone) && isValidSpawn(x, y, 40, 16)) {
      return { x, y };
    }
  }
  return { x: world.width * 0.5, y: world.height * 0.5 };
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pointInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function getSpawnPointInZone(zone, containerWidth, containerHeight) {
  return {
    x: zone.x + containerWidth / 2 + Math.random() * Math.max(1, zone.width - containerWidth),
    y: zone.y + containerHeight / 2 + Math.random() * Math.max(1, zone.height - containerHeight)
  };
}

function populateZoneContainers(zoneName, minCount, maxCount, colorOrPalette, label = "") {
  const zone = getZoneByName(zoneName);
  if (!zone) return;

  const targetCount = randomInt(minCount, maxCount);
  const maxAttempts = targetCount * 100;
  let created = 0;
  let attempts = 0;

  const chooseColor = () => {
    if (Array.isArray(colorOrPalette)) {
      return colorOrPalette[Math.floor(Math.random() * colorOrPalette.length)];
    }
    return colorOrPalette;
  };

  const playerStart = { x: world.width * 0.5, y: world.height * 0.5, radius: 30 };

  while (created < targetCount && attempts < maxAttempts) {
    attempts += 1;
    const width = 40;
    const height = 16;
    const pos = getSpawnPointInZone(zone, width, height);
    const candidate = new StaticContainer(pos.x, pos.y, chooseColor(), label);
    const rect = candidate.getRect();

    // Keep away from player spawn.
    const tooCloseToStart = Math.hypot(candidate.x - playerStart.x, candidate.y - playerStart.y) <= playerStart.radius;
    if (tooCloseToStart) continue;

    // Hard no-overlap using isValidSpawn
    if (!isValidSpawn(pos.x, pos.y, width, height)) continue;

    // Must stay strictly inside zone bounds.
    const topLeftInside = pointInsideRect(rect.x, rect.y, zone);
    const bottomRightInside = pointInsideRect(rect.x + rect.width, rect.y + rect.height, zone);
    if (!topLeftInside || !bottomRightInside) continue;

    staticContainers.push(candidate);
    created += 1;
  }
}

function populateStaticContainers() {
  staticContainers.length = 0;

  populateZoneContainers("ReeferZone", 4, 8, "#bdf1ff", "❄️");
  populateZoneContainers("IMDGZone", 4, 8, "#8b0000", "⚠️");
}

function updateTaskPanel(completed = false) {
  if (!currentTask || !ui.taskPanelList) return;
  const mark = completed ? "[X]" : "[ ]";
  ui.taskPanelList.innerHTML = `<li>${mark} Move ${currentTask.colorLabel} ${currentTask.type.toUpperCase()} to ${currentTask.target}</li>`;
}

function generateNewTask() {
  const randomTask = taskTypes[Math.floor(Math.random() * taskTypes.length)];
  const zone = getZoneByName(randomTask.target);
  const spawn = randomSpawnOutsideZone(zone);

  currentTask = {
    type: randomTask.type,
    target: randomTask.target,
    color: randomTask.color,
    colorLabel: randomTask.colorLabel
  };

  taskContainer.color = currentTask.color;
  taskContainer.x = spawn.x;
  taskContainer.y = spawn.y;
  taskContainer.isAttached = false;
  taskContainer.active = true;
  player.carryingContainer = null;
  pendingNextTaskAt = -1;
  reeferDeadlineMs = currentTask.type === "Reefer" ? performance.now() + REEFER_DURATION_MS : null;

  // Spawn a parked gate truck for export operations.
  if (currentTask.type === "Export" && zone) {
    activeTruck = new Truck(zone.x + zone.width / 2, zone.y + zone.height / 2);
  } else {
    activeTruck = null;
  }

  updateTaskPanel(false);
}

// -------------------------
// Runtime Objects
// -------------------------
const player = new Player(world.width * 0.5, world.height * 0.5);
const helicopter = new Helicopter(world.width * 0.5, world.height * 0.45);
const taskContainer = new Container(world.width * 0.5 + 120, world.height * 0.5, "#2a66ff");
const pedestrians = [];
const seagulls = [];
const smallBoats = [];
const hornWaves = [];
const staticContainers = [];
const trafficCones = [];
let zones = buildZones();
let buildings = buildBuildings();
let currentTask = null;
let activeTruck = null;
let shipContainers = [];
let parkedTrucks = [];
let trafficVehicles = [];
let nextTrafficSpawnMs = 0;
let lastTrafficCollisionAt = -Infinity;

function setupShip() {
  shipContainers.length = 0;
  const shipW = 180;
  const shipH = world.height * 0.8;
  const colors = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22"];
  for (let x = 10; x < shipW - 10; x += 20) {
    for (let y = 20; y < shipH - 120; y += 40) {
      shipContainers.push({
        x: x,
        y: y,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }
}

function spawnParkedTrucks() {
  parkedTrucks.length = 0;
  const pZone = getZoneByName("ParkingZone");
  if (!pZone) return;

  const truckW = 80;
  const truckH = 30;
  const minGap = 10; // minimum gap between trucks
  const maxAttempts = 100;

  let spawned = 0;
  let attempts = 0;
  while (spawned < 2 && attempts < maxAttempts) {
    attempts++;
    const tx = pZone.x + truckW / 2 + Math.random() * Math.max(0, pZone.width - truckW);
    const ty = pZone.y + truckH / 2 + Math.random() * Math.max(0, pZone.height - truckH);
    const candidate = { x: tx - truckW / 2, y: ty - truckH / 2, width: truckW, height: truckH };

    // Check overlap against already-placed trucks
    let overlaps = false;
    for (const pt of parkedTrucks) {
      const pr = pt.getRect();
      const expandedRect = {
        x: pr.x - minGap, y: pr.y - minGap,
        width: pr.width + minGap * 2, height: pr.height + minGap * 2
      };
      if (rectsOverlap(candidate, expandedRect)) { overlaps = true; break; }
    }
    if (!overlaps) {
      parkedTrucks.push(new Truck(tx, ty));
      spawned++;
    }
  }
}

const camera = {
  x: 0,
  y: 0
};

function spawnPedestrians(count) {
  pedestrians.length = 0;
  for (let i = 0; i < count; i += 1) {
    let x, y;
    let valid = false;
    for (let attempts = 0; attempts < 50; attempts++) {
      x = 310 + Math.random() * (world.width - 640);
      y = 15 + Math.random() * (world.height - 30);
      if (isValidSpawn(x, y, 12, 12)) {
        valid = true;
        break;
      }
    }
    if (valid) {
      pedestrians.push(new Pedestrian(x, y));
    }
  }
}
function spawnSeagulls() {
  seagulls.length = 0;
  const count = 5 + Math.floor(Math.random() * 4); // Spawns 5 to 8 seagulls

  for (let i = 0; i < count; i++) {
    // Spawn mostly near the water zone (right side of the map)
    const startX = world.width - 400 + Math.random() * 400;
    const startY = Math.random() * world.height;
    seagulls.push(new Seagull(startX, startY));
  }
}

function spawnCones() {
  trafficCones.length = 0;

  const perimeterZones = ["ParkingZone", "FuelStation", "GateZone"];

  for (const zoneName of perimeterZones) {
    const zone = getZoneByName(zoneName);
    if (!zone) continue;

    const count = 4 + Math.floor(Math.random() * 3); // 4 to 6 cones per zone

    for (let i = 0; i < count; i++) {
      const edge = Math.floor(Math.random() * 4); // 0=Top 1=Bottom 2=Left 3=Right
      let cx, cy;

      if (edge === 0) {
        // Top edge
        cx = zone.x + Math.random() * zone.width;
        cy = zone.y - 10;
      } else if (edge === 1) {
        // Bottom edge
        cx = zone.x + Math.random() * zone.width;
        cy = zone.y + zone.height + 10;
      } else if (edge === 2) {
        // Left edge
        cx = zone.x - 10;
        cy = zone.y + Math.random() * zone.height;
      } else {
        // Right edge
        cx = zone.x + zone.width + 10;
        cy = zone.y + Math.random() * zone.height;
      }

      trafficCones.push(new TrafficCone(cx, cy));
    }
  }
}



function updateCamera() {
  camera.x = player.x - canvas.width / 2;
  camera.y = player.y - canvas.height / 2;
  camera.x = clamp(camera.x, 0, Math.max(0, world.width - canvas.width));
  camera.y = clamp(camera.y, 0, Math.max(0, world.height - canvas.height));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function canPickupContainer() {
  if (!taskContainer.active || taskContainer.isAttached || player.isLoaded) return false;
  return distance(player, taskContainer) <= pickupRange;
}

function drawBackground() {
  // Base asphalt color
  ctx.fillStyle = "#2a2b2e";
  ctx.fillRect(-camera.x, -camera.y, world.width, world.height);

  // Left asphalt road
  ctx.fillStyle = "#333333";
  ctx.fillRect(-camera.x, -camera.y, 240, world.height);

  // Solid gray median barrier
  ctx.fillStyle = "#555555";
  ctx.fillRect(115 - camera.x, -camera.y, 10, world.height);

  // Dashed yellow lines separating Downward lanes
  ctx.strokeStyle = "#ffdd00";
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 20]);
  ctx.beginPath();
  ctx.moveTo(65 - camera.x, -camera.y);
  ctx.lineTo(65 - camera.x, world.height - camera.y);
  ctx.stroke();

  // Dashed yellow lines separating Upward lanes
  ctx.beginPath();
  ctx.moveTo(175 - camera.x, -camera.y);
  ctx.lineTo(175 - camera.x, world.height - camera.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Subtle '+' grid intersections
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  for (let x = 400; x < world.width - 300; x += 400) {
    for (let y = 300; y < world.height; y += 300) {
      // Draw a tiny '+' at each grid intersection
      ctx.fillRect(x - camera.x - 4, y - camera.y - 1, 8, 2); // Horizontal bar
      ctx.fillRect(x - camera.x - 1, y - camera.y - 4, 2, 8); // Vertical bar
    }
  }
}

function drawZones() {
  for (const zone of zones) {
    ctx.save();
    const zx = zone.x - camera.x;
    const zy = zone.y - camera.y;

    switch (zone.name) {
      case "CYZone":
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeRect(zx, zy, zone.width, zone.height);

        ctx.beginPath();
        ctx.setLineDash([15, 15]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 2;
        for (let i = 60; i < zone.width; i += 60) {
          ctx.moveTo(zx + i, zy);
          ctx.lineTo(zx + i, zy + zone.height);
        }
        for (let i = 40; i < zone.height; i += 40) {
          ctx.moveTo(zx, zy + i);
          ctx.lineTo(zx + zone.width, zy + i);
        }
        ctx.stroke();
        break;

      case "IMDGZone":
        ctx.strokeStyle = "#ff0000";
        ctx.lineWidth = 4;
        ctx.strokeRect(zx, zy, zone.width, zone.height);

        ctx.fillStyle = "rgba(255, 0, 0, 0.05)";
        ctx.fillRect(zx, zy, zone.width, zone.height);

        ctx.font = "bold 48px sans-serif";
        ctx.fillStyle = "rgba(255, 0, 0, 0.25)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("IMDG", zx + zone.width / 2, zy + zone.height / 2);
        break;

      case "ReeferZone":
        ctx.strokeStyle = "#87cefa";
        ctx.lineWidth = 4;
        ctx.strokeRect(zx, zy, zone.width, zone.height);

        ctx.fillStyle = "#1e90ff";
        for (let i = 20; i < zone.width; i += 50) {
          ctx.fillRect(zx + i, zy + 5, 12, 12);
        }
        ctx.font = "bold 48px sans-serif";
        ctx.fillStyle = "rgba(98, 166, 222, 0.65)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("REEFER", zx + zone.width / 2, zy + zone.height / 2);

        break;

      case "GateZone":
        // Concrete lanes
        ctx.fillStyle = "#7f8c8d";
        ctx.fillRect(zx, zy, zone.width, zone.height);

        // Reflective Road Studs (Cat's Eyes)
        ctx.fillStyle = "#ecf0f1"; // Bright silver/white
        const dotSpacing = 20;     // Space between each reflector

        // Loop down the height of the zone to place dots
        for (let yOffset = 10; yOffset < zone.height; yOffset += dotSpacing) {
          // Left lane studs
          ctx.fillRect(zx + zone.width / 3 - 2, zy + yOffset, 4, 4);
          // Right lane studs
          ctx.fillRect(zx + 2 * zone.width / 3 - 2, zy + yOffset, 4, 4);
        }

        // Guard Booth
        ctx.fillStyle = "#bdc3c7";
        const boothW = 40, boothH = 30;
        ctx.fillRect(zx + zone.width / 2 - boothW / 2, zy + zone.height / 2 - boothH / 2, boothW, boothH);
        ctx.fillStyle = "#3498db"; // blue window
        ctx.fillRect(zx + zone.width / 2 - 10, zy + zone.height / 2 - 10, 20, 20);

        // Boom barriers (striped)
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#e74c3c";
        ctx.beginPath();
        // left barrier
        ctx.moveTo(zx + zone.width / 2 - 20, zy + zone.height / 2);
        ctx.lineTo(zx, zy + zone.height / 2);
        // right barrier
        ctx.moveTo(zx + zone.width / 2 + 20, zy + zone.height / 2);
        ctx.lineTo(zx + zone.width, zy + zone.height / 2);
        ctx.stroke();

        ctx.font = "bold 20px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("EXPORT GATE", zx + zone.width / 2, zy + 5);
        break;

      case "FuelStation":
        // Solid concrete island (Base)
        ctx.fillStyle = "#8a8d91"; // Darker, realistic concrete
        ctx.fillRect(zx + 10, zy + 10, zone.width - 20, zone.height - 20);

        // Island Border (Yellow/Black warning stripes effect)
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#FFD700";
        ctx.setLineDash([10, 10]);
        ctx.strokeRect(zx + 10, zy + 10, zone.width - 20, zone.height - 20);
        ctx.setLineDash([]); // Reset dash

        // Pump 1 (Left) - Detailed
        ctx.fillStyle = "#c0392b"; // Deep Red Body
        ctx.fillRect(zx + 25, zy + zone.height / 2 - 20, 20, 40);
        ctx.fillStyle = "#bdc3c7"; // Silver Panel
        ctx.fillRect(zx + 28, zy + zone.height / 2 - 15, 14, 20);
        ctx.fillStyle = "#2c3e50"; // Screen
        ctx.fillRect(zx + 30, zy + zone.height / 2 - 12, 10, 8);
        ctx.fillStyle = "#27ae60"; // Green Hose/Nozzle
        ctx.fillRect(zx + 20, zy + zone.height / 2 - 10, 5, 15);

        // Pump 2 (Right) - Detailed
        ctx.fillStyle = "#c0392b"; // Deep Red Body
        ctx.fillRect(zx + zone.width - 45, zy + zone.height / 2 - 20, 20, 40);
        ctx.fillStyle = "#bdc3c7"; // Silver Panel
        ctx.fillRect(zx + zone.width - 42, zy + zone.height / 2 - 15, 14, 20);
        ctx.fillStyle = "#2c3e50"; // Screen
        ctx.fillRect(zx + zone.width - 40, zy + zone.height / 2 - 12, 10, 8);
        ctx.fillStyle = "#27ae60"; // Green Hose/Nozzle
        ctx.fillRect(zx + zone.width - 25, zy + zone.height / 2 - 10, 5, 15);

        // Canopy roof (Shadow effect added for depth)
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;

        ctx.fillStyle = "rgba(241, 196, 15, 0.1)"; // Bright yellow, less transparent
        ctx.fillRect(zx, zy, zone.width, zone.height);

        // Reset shadow so it doesn't affect the text
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Canopy Border
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#d4ac0d";
        ctx.strokeRect(zx, zy, zone.width, zone.height);

        // Text
        ctx.font = "bold 26px 'Arial Black', sans-serif";
        ctx.fillStyle = "#2c3e50";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("FUEL", zx + zone.width / 2, zy + zone.height / 2);
        break;

      case "ParkingZone":
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.strokeRect(zx, zy, zone.width, zone.height);

        ctx.beginPath();
        for (let y = 30; y < zone.height; y += 40) {
          ctx.moveTo(zx, zy + y);
          ctx.lineTo(zx + zone.width, zy + y);
        }
        ctx.stroke();

        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PARKING", zx + zone.width / 2, zy + zone.height / 2);
        break;
    }
    ctx.restore();
  }
  ctx.setLineDash([]);
}

function drawBuildings(ctx, cam) {
  for (const b of buildings) {
    if (b.type === "warehouse") {
      ctx.fillStyle = "#8b4513";
      ctx.fillRect(b.x - cam.x, b.y - cam.y, b.width, b.height);

      ctx.strokeStyle = "#5a2e0c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y < b.height; y += 10) {
        ctx.moveTo(b.x - cam.x, b.y + y - cam.y);
        ctx.lineTo(b.x + b.width - cam.x, b.y + y - cam.y);
      }
      for (let y = 0; y < b.height; y += 10) {
        const offset = (y / 10) % 2 === 0 ? 0 : 10;
        for (let x = offset; x < b.width; x += 20) {
          ctx.moveTo(b.x + x - cam.x, b.y + y - cam.y);
          ctx.lineTo(b.x + x - cam.x, b.y + y + 10 - cam.y);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x - cam.x, b.y - cam.y, b.width, b.height);

      // --- Street Lamp ---
      const lx = b.x + b.width / 2 - cam.x + 80;
      const ly = b.y + b.height + 15 - cam.y + 15;
      ctx.fillStyle = "#555";
      ctx.fillRect(lx - 3, ly - 8, 6, 16); // post
      ctx.fillStyle = "#ffdd55";
      ctx.beginPath();
      ctx.arc(lx, ly - 8, 6, 0, Math.PI * 2); // bulb
      ctx.fill();

    } else if (b.type === "office") {
      ctx.fillStyle = "#a9a9a9";
      ctx.fillRect(b.x - cam.x, b.y - cam.y, b.width, b.height);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x - cam.x, b.y - cam.y, b.width, b.height);

    } else if (b.type === "containerBlock") {
      // Defer entirely to the new ContainerBlock class's internal draw logic
      b.draw(ctx, cam);

    } else if (b.type === "helipad") {
      ctx.save();
      const hx = b.x - cam.x;
      const hy = b.y - cam.y;

      // Dark gray concrete circle
      ctx.fillStyle = "#2c3e50";
      ctx.beginPath();
      ctx.arc(hx, hy, b.radius, 0, Math.PI * 2);
      ctx.fill();

      // Painted inner safety ring
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, b.radius - 6, 0, Math.PI * 2);
      ctx.stroke();

      // Large Yellow 'H'
      ctx.fillStyle = "#f1c40f";
      ctx.font = "bold 54px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("H", hx, hy + 4);

      ctx.restore();
    }
  }
}

function drawInfrastructure(ctx, cam) {
  ctx.save();

  // 2. The Sea & Dock
  // Sea — gradient from deep to lighter blue
  const seaX = world.width - 300 - cam.x;
  const seaGrad = ctx.createLinearGradient(seaX, 0, seaX + 300, 0);
  seaGrad.addColorStop(0, "#0b2e4a");
  seaGrad.addColorStop(1, "#1a4f73");
  ctx.fillStyle = seaGrad;
  ctx.fillRect(seaX, -cam.y, 300, world.height);

  // Gentle wave lines
  ctx.save();
  ctx.strokeStyle = "rgba(100, 200, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.setLineDash([18, 14]);
  for (let wy = 60; wy < world.height; wy += 80) {
    ctx.beginPath();
    ctx.moveTo(seaX, wy - cam.y);
    ctx.quadraticCurveTo(seaX + 80, wy - 8 - cam.y, seaX + 160, wy - cam.y);
    ctx.quadraticCurveTo(seaX + 240, wy + 8 - cam.y, seaX + 300, wy - cam.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // Quay/Dock Edge
  ctx.fillStyle = "#7a8591";
  ctx.fillRect(world.width - 340 - cam.x, - cam.y, 40, world.height);

  // Bollards
  ctx.fillStyle = "#ffff00";
  for (let y = 15; y < world.height; y += 100) {
    ctx.beginPath();
    ctx.arc(world.width - 320 - cam.x, y - cam.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. The Mega Cargo Ship
  const shipX = world.width - 250 - cam.x;
  const shipY = world.height * 0.1 + 55 - cam.y;
  const shipW = 180;
  const shipH = world.height * 0.8;
  const bowTipY = shipY - 120; // Extend the bow 120 pixels forward

  // Ship Body (Triangular Bow + Flat Stern)
  ctx.fillStyle = "#2c3e50";
  ctx.beginPath();
  ctx.moveTo(shipX + shipW / 2, bowTipY);   // Sharp bow tip
  ctx.lineTo(shipX + shipW, shipY);         // Starboard bow taper
  ctx.lineTo(shipX + shipW, shipY + shipH); // Starboard stern corner
  ctx.lineTo(shipX, shipY + shipH);         // Port stern corner
  ctx.lineTo(shipX, shipY);                 // Port bow taper
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#1a252f";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Cargo Bays (Stacked containers from shipContainers array)
  for (const sc of shipContainers) {
    ctx.fillStyle = sc.color;
    ctx.fillRect(shipX + sc.x, shipY + sc.y, 18, 38);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(shipX + sc.x, shipY + sc.y, 18, 38);
  }

  // Ship Bridge/Cabin
  ctx.fillStyle = "#ecf0f1";
  ctx.fillRect(shipX, shipY + shipH - 100, shipW, 80);
  ctx.fillStyle = "#95a5a6";
  ctx.fillRect(shipX + 20, shipY + shipH - 100, shipW - 40, 20);
  ctx.fillStyle = "#7f8c8d";
  ctx.beginPath();
  ctx.arc(shipX + shipW / 2, shipY + shipH - 60, 15, 0, Math.PI * 2);
  ctx.fill();

  // 4. STS Cranes
  const craneYs = [world.height * 0.3, world.height * 0.5, world.height * 0.7];
  let craneIndex = 0; // Used to desynchronize the crane animations

  for (const cy of craneYs) {
    const craneYCam = cy - cam.y;
    const dockX = world.width - 340 - cam.x;

    // Legs
    ctx.fillStyle = "#f1c40f";
    ctx.fillRect(dockX + 5, craneYCam - 15, 12, 12);
    ctx.fillRect(dockX + 5, craneYCam + 15, 12, 12);

    // Boom
    ctx.fillStyle = "#7f8c8d";
    ctx.fillRect(dockX + 10, craneYCam - 12, 260, 24);

    // Boom details
    ctx.strokeStyle = "#34495e";
    ctx.lineWidth = 2;
    ctx.strokeRect(dockX + 10, craneYCam - 12, 260, 24);
    ctx.beginPath();
    for (let i = dockX + 20; i < dockX + 260; i += 20) {
      ctx.moveTo(i, craneYCam - 12);
      ctx.lineTo(i + 10, craneYCam + 12);
      ctx.moveTo(i + 10, craneYCam - 12);
      ctx.lineTo(i, craneYCam + 12);
    }
    ctx.stroke();

    // Diagonal supports
    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(dockX + 11, craneYCam - 9);
    ctx.lineTo(dockX + 40, craneYCam);
    ctx.moveTo(dockX + 11, craneYCam + 21);
    ctx.lineTo(dockX + 40, craneYCam);
    ctx.stroke();

    // --- Animated Hoist & Cargo ---
    const maxDropDistance = 70;
    // Calculate a smooth drop using time, offset by the crane index so they don't move in unison
    const hoistDrop = Math.abs(Math.sin(Date.now() / 1500 + craneIndex)) * maxDropDistance;

    // Position the hoist horizontally over the ship's cargo bays
    const hoistX = dockX + 160;
    const boomBottomY = craneYCam + 12;

    // Draw the steel cable
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hoistX, boomBottomY);
    ctx.lineTo(hoistX, boomBottomY + hoistDrop);
    ctx.stroke();

    // Draw the Spreader/Container at the end of the cable
    // Alternate container colors slightly for variety based on the crane index
    ctx.fillStyle = craneIndex % 2 === 0 ? "#e67e22" : "#3498db";
    ctx.fillRect(hoistX - 12, boomBottomY + hoistDrop, 24, 12);

    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.strokeRect(hoistX - 12, boomBottomY + hoistDrop, 24, 12);

    craneIndex++;
  }

  ctx.restore();
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function handleTaskSuccess(nowMs) {
  feedbackText = "GOOD JOB! +10 Points";
  feedbackColor = "#49ff7d";
  feedbackUntil = nowMs + 2000;

  efficiencyScore += 10;
  globalTimeLeft += 10;
  updateTaskPanel(true);

  pendingNextTaskAt = nowMs + 2000;
  taskContainer.active = false;
  reeferDeadlineMs = null;
}

function handleContainerToggle(nowMs) {
  if (!actions.toggleContainer) return;
  actions.toggleContainer = false;

  if (player.isLoaded) {
    const dropped = player.carryingContainer;
    dropped.isAttached = false;
    dropped.x = player.x;
    dropped.y = player.y;
    player.carryingContainer = null;

    if (currentTask) {
      const targetZone = getZoneByName(currentTask.target);
      let isValidDrop = false;

      if (currentTask.type === "Export" && activeTruck && activeTruck.active) {
        const containerRect = {
          x: dropped.x - dropped.width / 2,
          y: dropped.y - dropped.height / 2,
          width: dropped.width,
          height: dropped.height
        };
        isValidDrop = rectsOverlap(containerRect, activeTruck.getTrailerRect());
      } else if (targetZone) {
        isValidDrop = containerInsideZone(dropped, targetZone);
      }

      if (isValidDrop) {
        if (currentTask.type === "Export" && activeTruck && activeTruck.active) {
          activeTruck.departing = true;
          activeTruck.speed = 100;
        }
        handleTaskSuccess(nowMs);
      } else {
        // Wrong drop penalty: keep same task/container active.
        feedbackText = "WRONG ZONE! -5 Points";
        feedbackColor = "#ff2b2b";
        feedbackUntil = nowMs + 2000;
        efficiencyScore -= 5;
      }
    }
    return;
  }

  if (canPickupContainer()) {
    taskContainer.isAttached = true;
    player.carryingContainer = taskContainer;
    taskContainer.x = player.x;
    taskContainer.y = player.y;
  }
}

function handleHonk(nowMs) {
  if (!actions.honk) return;
  actions.honk = false;
  if (gameState !== GAME_STATE.RUNNING) return;

  // Pressing again while audio is active does nothing.
  if (!hornAudio.paused) return;

  lastHonkAt = nowMs;
  playHorn();

  hornWaves.push({
    x: player.x,
    y: player.y,
    radius: 16,
    maxRadius: 160,
    alpha: 0.85
  });

  for (const pedestrian of pedestrians) {
    if (distance(player, pedestrian) <= hornHitRadius) {
      pedestrian.triggerSprint(nowMs);
    }
  }
}

function updateHornWaves() {
  for (let i = hornWaves.length - 1; i >= 0; i -= 1) {
    const wave = hornWaves[i];
    wave.radius += 7;
    wave.alpha -= 0.035;
    if (wave.radius >= wave.maxRadius || wave.alpha <= 0) {
      hornWaves.splice(i, 1);
    }
  }
}

function drawHornWaves() {
  for (const wave of hornWaves) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 221, 33, ${wave.alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(wave.x - camera.x, wave.y - camera.y, wave.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function isRecentHonk(nowMs) {
  return nowMs - lastHonkAt <= honkSafetyWindowMs;
}

function checkNearMissViolations(nowMs) {
  if (isRecentHonk(nowMs)) return;

  for (const pedestrian of pedestrians) {
    if (distance(player, pedestrian) <= nearMissRadius) {
      if (nowMs - pedestrian.lastViolationAt >= nearMissCooldownMs) {
        safetyViolations += 1;
        pedestrian.lastViolationAt = nowMs;
      }
    }
  }
}

function rectCircleCollision(rect, circle) {
  const left = rect.x - rect.width / 2;
  const right = rect.x + rect.width / 3;
  const top = rect.y - rect.height / 3;
  const bottom = rect.y + rect.height / 3;
  const closestX = clamp(circle.x, left, right);
  const closestY = clamp(circle.y, top, bottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function checkFatalCollision() {
  if (gameState !== GAME_STATE.RUNNING) return;
  for (const pedestrian of pedestrians) {
    if (rectCircleCollision(player, pedestrian)) {
      gameState = GAME_STATE.GAME_OVER;
      gameOverMessage = "GAME OVER - ACCIDENT";
      stopReverseAudio();
      return;
    }
  }
}

function drawFloatingPrompt() {
  let label = "";
  if (player.isLoaded) {
    label = "Press SPACE to drop";
  } else if (canPickupContainer()) {
    label = "Press SPACE to pickup";
  }
  if (!label) return;

  const x = player.x - camera.x;
  const y = player.y - camera.y - 34;

  ctx.save();
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x, y);
  ctx.restore();
}

function drawFeedback(nowMs) {
  if (nowMs > feedbackUntil || !feedbackText) return;
  const x = player.x - camera.x;
  const y = player.y - camera.y - 58;

  ctx.save();
  ctx.font = "bold 18px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = feedbackColor;
  ctx.fillText(feedbackText, x, y);
  ctx.restore();
}

function drawReeferCountdown(nowMs) {
  if (!currentTask || currentTask.type !== "Reefer") return;
  if (reeferDeadlineMs === null) return;
  if (!taskContainer.active && !player.isLoaded) return;

  const secondsLeft = Math.max(0, Math.ceil((reeferDeadlineMs - nowMs) / 1000));
  const anchorX = player.isLoaded ? player.x : taskContainer.x;
  const anchorY = player.isLoaded ? player.y : taskContainer.y;
  const x = anchorX - camera.x;
  const y = anchorY - camera.y - 78;

  ctx.save();
  ctx.font = "bold 16px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Spoils in: ${secondsLeft}s`, x, y);
  ctx.restore();
}

// -------------------------
// Day/Night Lighting
// -------------------------
const lightCanvas = document.createElement("canvas");
const lightCtx = lightCanvas.getContext("2d");

function getDarkness() {
  if (shiftTimeHours >= 8 && shiftTimeHours < 18) return 0;
  if (shiftTimeHours >= 18 && shiftTimeHours < 20) {
    return ((shiftTimeHours - 18) / 2) * 0.75;
  }
  if (shiftTimeHours >= 20 || shiftTimeHours < 6) return 0.75;
  // 06:00 – 08:00 dawn
  return (1 - (shiftTimeHours - 6) / 2) * 0.75;
}

function drawLighting() {
  const darkness = getDarkness();
  if (darkness <= 0) return;

  // Match offscreen canvas size.
  if (lightCanvas.width !== 1920) {
    lightCanvas.width = 1920;
    lightCanvas.height = 1080;
  }

  // 1) Fill with darkness.
  lightCtx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
  lightCtx.globalCompositeOperation = "source-over";
  lightCtx.fillStyle = `rgba(0, 0, 20, ${darkness})`;
  lightCtx.fillRect(0, 0, lightCanvas.width, lightCanvas.height);

  if (darkness > 0.1) {
    // 2) Cut out light areas with destination-out.
    lightCtx.globalCompositeOperation = "destination-out";

    // --- Player Headlights ---
    const headlightRange = 180;
    const coneHalfAngle = 0.5;
    const frontX = player.x + Math.cos(player.angle) * (player.width / 2) - camera.x;
    const frontY = player.y + Math.sin(player.angle) * (player.height / 2) - camera.y;

    const hGrad = lightCtx.createRadialGradient(frontX, frontY, 4, frontX, frontY, headlightRange);
    hGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
    hGrad.addColorStop(0.45, "rgba(255, 255, 255, 0.7)");
    hGrad.addColorStop(1, "rgba(255, 255, 255, 0)");

    lightCtx.beginPath();
    lightCtx.moveTo(frontX, frontY);
    lightCtx.arc(frontX, frontY, headlightRange, player.angle - coneHalfAngle, player.angle + coneHalfAngle);
    lightCtx.closePath();
    lightCtx.fillStyle = hGrad;
    lightCtx.fill();

    // --- Small ambient glow around the player ---
    const px = player.x - camera.x;
    const py = player.y - camera.y;
    const aGrad = lightCtx.createRadialGradient(px, py, 0, px, py, 52);
    aGrad.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    aGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    lightCtx.beginPath();
    lightCtx.arc(px, py, 52, 0, Math.PI * 2);
    lightCtx.fillStyle = aGrad;
    lightCtx.fill();

    // --- Traffic Vehicle Headlights ---
    for (const tv of trafficVehicles) {
      const tvAngle = tv.direction === 1 ? Math.PI / 2 : -Math.PI / 2;
      const tvFrontX = tv.x - camera.x;
      const tvFrontY = tv.y + (tv.direction === 1 ? tv.height / 2 : -tv.height / 2) - camera.y;
      const tvRange = 130;
      const tvGrad = lightCtx.createRadialGradient(tvFrontX, tvFrontY, 4, tvFrontX, tvFrontY, tvRange);
      tvGrad.addColorStop(0, "rgba(255, 255, 220, 0.9)");
      tvGrad.addColorStop(0.5, "rgba(255, 255, 200, 0.5)");
      tvGrad.addColorStop(1, "rgba(255, 255, 200, 0)");
      lightCtx.beginPath();
      lightCtx.moveTo(tvFrontX, tvFrontY);
      lightCtx.arc(tvFrontX, tvFrontY, tvRange, tvAngle - 0.4, tvAngle + 0.4);
      lightCtx.closePath();
      lightCtx.fillStyle = tvGrad;
      lightCtx.fill();
    }

    // --- Glowing Traffic Cones ---
    for (const cone of trafficCones) {
      const cx = cone.x - camera.x;
      const cy = cone.y - camera.y;
      const cGrad = lightCtx.createRadialGradient(cx, cy, 0, cx, cy, 28);
      cGrad.addColorStop(0, "rgba(255, 160, 30, 0.85)");
      cGrad.addColorStop(0.5, "rgba(255, 120, 0, 0.35)");
      cGrad.addColorStop(1, "rgba(255, 100, 0, 0)");
      lightCtx.beginPath();
      lightCtx.arc(cx, cy, 28, 0, Math.PI * 2);
      lightCtx.fillStyle = cGrad;
      lightCtx.fill();
    }

    // --- Worker Reflectors ---
    for (const ped of pedestrians) {
      const wx = ped.x - camera.x;
      const wy = ped.y - camera.y;
      const rGrad = lightCtx.createRadialGradient(wx, wy, 0, wx, wy, 24);
      rGrad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      rGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      lightCtx.beginPath();
      lightCtx.arc(wx, wy, 24, 0, Math.PI * 2);
      lightCtx.fillStyle = rGrad;
      lightCtx.fill();
    }

    // --- Task container glow ---
    if (taskContainer.active && !taskContainer.isAttached) {
      const tx = taskContainer.x - camera.x;
      const ty = taskContainer.y - camera.y;
      const tGrad = lightCtx.createRadialGradient(tx, ty, 0, tx, ty, 30);
      tGrad.addColorStop(0, "rgba(255, 255, 255, 0.7)");
      tGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      lightCtx.beginPath();
      lightCtx.arc(tx, ty, 30, 0, Math.PI * 2);
      lightCtx.fillStyle = tGrad;
      lightCtx.fill();
    }

    // --- Warehouse Street Lamp Glow ---
    for (const b of buildings) {
      if (b.type === "warehouse") {
        const lx = b.x + b.width / 2 - camera.x;
        const ly = b.y + b.height + 15 - camera.y;
        const lampGrad = lightCtx.createRadialGradient(lx, ly, 0, lx, ly, 180);
        lampGrad.addColorStop(0, "rgba(255, 230, 150, 0.95)");
        lampGrad.addColorStop(0.3, "rgba(255, 200, 100, 0.5)");
        lampGrad.addColorStop(1, "rgba(255, 180, 50, 0)");
        lightCtx.beginPath();
        lightCtx.arc(lx, ly, 180, 0, Math.PI * 2);
        lightCtx.fillStyle = lampGrad;
        lightCtx.fill();
      }
    }

    if (typeof helicopter !== "undefined") {
      const hx = helicopter.x - camera.x;
      const hy = helicopter.y - camera.y;

      const spotRange = 350;
      const spotHalfAngle = 0.35;
      const spotGrad = lightCtx.createRadialGradient(hx, hy, 10, hx, hy, spotRange);
      spotGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
      spotGrad.addColorStop(0.4, "rgba(255, 255, 200, 0.6)");
      spotGrad.addColorStop(1, "rgba(255, 255, 200, 0)");

      lightCtx.beginPath();
      lightCtx.moveTo(hx, hy);
      // Shine the spotlight forward based on the helicopter's current angle
      lightCtx.arc(hx, hy, spotRange, helicopter.angle - spotHalfAngle, helicopter.angle + spotHalfAngle);
      lightCtx.closePath();
      lightCtx.fillStyle = spotGrad;
      lightCtx.fill();

      // Switch composite operation to draw colored, glowing additive light
      lightCtx.globalCompositeOperation = "lighter";

      // --- Helicopter Blinking Aviation Light ---
      if (Math.sin(Date.now() / 200) > 0) {
        const blinkGrad = lightCtx.createRadialGradient(hx, hy, 0, hx, hy, 25);
        blinkGrad.addColorStop(0, "rgba(255, 255, 255, 1)");      // Bright white core
        blinkGrad.addColorStop(0.3, "rgba(255, 50, 50, 0.8)");    // Sharp red halo
        blinkGrad.addColorStop(1, "rgba(255, 50, 50, 0)");        // Fade out

        lightCtx.beginPath();
        lightCtx.arc(hx, hy, 25, 0, Math.PI * 2);
        lightCtx.fillStyle = blinkGrad;
        lightCtx.fill();
      }

      // Reset back to destination-out in case anything else draws after this
      lightCtx.globalCompositeOperation = "destination-out";
    }
  }

  lightCtx.globalCompositeOperation = "source-over";

  // 3) Composite lighting layer onto main canvas.
  ctx.drawImage(lightCanvas, 0, 0);
}

function drawGameOverOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 62px sans-serif";
  ctx.fillStyle = "#ff2b2b";
  ctx.fillText(gameOverMessage, canvas.width / 2, canvas.height / 2 - 20);
  ctx.font = "bold 24px monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Double tap SPACE to restart", canvas.width / 2, canvas.height / 2 + 44);
  ctx.restore();
}

function setRuleStatus(element, pass) {
  if (!element) return;
  element.textContent = pass ? "✓" : "✗";
  element.classList.remove("pass", "fail");
  element.classList.add(pass ? "pass" : "fail");
}

function hasNearbyWorker() {
  for (const pedestrian of pedestrians) {
    if (distance(player, pedestrian) <= nearMissRadius) return true;
  }
  return false;
}

function updateOverlayUi(nowMs) {
  ui.scoreValue.textContent = `Score: ${efficiencyScore}%`;

  const timeLeftSeconds = Math.max(0, Math.ceil(globalTimeLeft));
  ui.shiftClockValue.textContent = `Time: ${timeLeftSeconds}s`;
  if (timeLeftSeconds < 15) {
    ui.shiftClockValue.style.color = "#ff2b2b";
    ui.shiftClockValue.style.opacity = Math.floor(nowMs / 250) % 2 === 0 ? "1" : "0.35";
  } else {
    ui.shiftClockValue.style.color = "#f5f5f5";
    ui.shiftClockValue.style.opacity = "1";
  }

  const speedKmh = Math.round(Math.abs(player.speed) * 10);
  ui.vehicleSpeedValue.textContent = `Speed: ${speedKmh} km/h`;
  ui.vehicleLoadValue.textContent = `Status: ${player.isLoaded ? "LOADED" : "EMPTY"}`;
  ui.vehicleLoadValue.style.color = player.isLoaded ? "#ff9f1a" : "#4cff77";
  ui.vehicleFuelValue.textContent = `Fuel: ${Math.round(player.fuel)}%`;
  ui.vehicleFuelValue.style.color = player.fuel < 20 ? "#ff2b2b" : "#f5f5f5";

  setRuleStatus(ui.speedRuleStatus, speedKmh <= speedLimitKmh);

  const workerNear = hasNearbyWorker();
  const hornCompliant = !workerNear || isRecentHonk(nowMs);
  setRuleStatus(ui.hornRuleStatus, hornCompliant);
  setRuleStatus(ui.collisionRuleStatus, gameState !== GAME_STATE.GAME_OVER);

  violationsRow.textContent = `Safety Violations: ${safetyViolations}`;
}

function updateFuelSystem(dt) {
  if (gameState !== GAME_STATE.RUNNING) return;

  if (player.speed !== 0) {
    const multiplier = player.isLoaded ? 2 : 1;
    player.fuel -= player.fuelConsumptionRate * multiplier * dt;
  }

  const fuelZone = getZoneByName("FuelStation");
  const atFuelStation = fuelZone && pointInsideZone(player.x, player.y, fuelZone);
  if (atFuelStation && player.speed === 0) {
    player.fuel += 40 * dt;
  }

  player.fuel = clamp(player.fuel, 0, 100);

  if (player.fuel <= 0) {
    gameState = GAME_STATE.GAME_OVER;
    gameOverMessage = "GAME OVER - OUT OF FUEL";
    stopReverseAudio();
  }
}

function checkReeferSpoilage(nowMs) {
  if (!currentTask || currentTask.type !== "Reefer") return;
  if (reeferDeadlineMs === null) return;
  if (nowMs < reeferDeadlineMs) return;

  // Time up: auto-drop (if carried), penalize, and fail current task immediately.
  if (player.isLoaded && player.carryingContainer) {
    const dropped = player.carryingContainer;
    dropped.isAttached = false;
    dropped.x = player.x;
    dropped.y = player.y;
    player.carryingContainer = null;
  }
  taskContainer.active = false;
  reeferDeadlineMs = null;

  feedbackText = "CARGO SPOILED! -15 Pts";
  feedbackColor = "#ff2b2b";
  feedbackUntil = nowMs + 2000;
  efficiencyScore -= 15;

  generateNewTask();
}

function drawMinimap() {
  const mmw = minimapCanvas.width;
  const mmh = minimapCanvas.height;
  const sx = mmw / world.width;
  const sy = mmh / world.height;

  minimapCtx.clearRect(0, 0, mmw, mmh);
  minimapCtx.fillStyle = "rgba(8, 12, 17, 0.95)";
  minimapCtx.fillRect(0, 0, mmw, mmh);

  // Draw Water zone
  minimapCtx.fillStyle = "#1e5b82";
  minimapCtx.fillRect((world.width - 300) * sx, 0, 300 * sx, mmh);

  // Draw Mega Ship on the Minimap
  const mShipX = (world.width - 250) * sx;
  const mShipY = (world.height * 0.1) * sy;
  const mShipW = 180 * sx;
  const mShipH = (world.height * 0.8) * sy;
  const mBowTipY = (world.height * 0.1 - 120) * sy;

  minimapCtx.fillStyle = "#2c3e50";
  minimapCtx.beginPath();
  minimapCtx.moveTo(mShipX + mShipW / 2, mBowTipY);
  minimapCtx.lineTo(mShipX + mShipW, mShipY);
  minimapCtx.lineTo(mShipX + mShipW, mShipY + mShipH);
  minimapCtx.lineTo(mShipX, mShipY + mShipH);
  minimapCtx.lineTo(mShipX, mShipY);
  minimapCtx.closePath();
  minimapCtx.fill();

  // Zone labels mapping
  const zoneLabels = {
    "ReeferZone": "REEFER",
    "IMDGZone": "IMDG",
    "CYZone": "CY",
    "GateZone": "GATE",
    "FuelStation": "FUEL",
    "ParkingZone": "PARK"
  };

  // Draw zones as hollow rectangles with name labels.
  for (const zone of zones) {
    minimapCtx.save();
    const zx = zone.x * sx;
    const zy = zone.y * sy;
    const zw = zone.width * sx;
    const zh = zone.height * sy;

    // Outline
    minimapCtx.strokeStyle = zone.color.replace(/,\s*0?\.?\d+\)/, ", 0.95)");
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeRect(zx, zy, zw, zh);

    // Name label
    const label = zoneLabels[zone.name] || zone.name;
    const fontSize = Math.max(5, Math.min(9, zh * 0.35));
    minimapCtx.font = `bold ${fontSize}px sans-serif`;
    minimapCtx.textAlign = "center";
    minimapCtx.textBaseline = "middle";
    minimapCtx.fillStyle = "rgba(255,255,255,0.85)";
    minimapCtx.fillText(label, zx + zw / 2, zy + zh / 2);

    minimapCtx.restore();
  }

  // Draw buildings (like warehouse)
  for (const b of buildings) {
    if (b.type === "warehouse") {
      minimapCtx.fillStyle = "#8b4513";
      minimapCtx.fillRect(b.x * sx, b.y * sy, b.width * sx, b.height * sy);
    }
  }

  // Active task container as colored dot.
  if (taskContainer.active) {
    minimapCtx.fillStyle = taskContainer.color;
    minimapCtx.beginPath();
    minimapCtx.arc(taskContainer.x * sx, taskContainer.y * sy, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  if (activeTruck && activeTruck.active) {
    minimapCtx.fillStyle = "#ff0000";
    minimapCtx.fillRect((activeTruck.x - activeTruck.width / 2) * sx, (activeTruck.y - activeTruck.height / 2) * sy, activeTruck.width * sx, activeTruck.height * sy);
  }

  for (const pt of parkedTrucks) {
    minimapCtx.fillStyle = "#ff0000";
    minimapCtx.fillRect((pt.x - pt.width / 2) * sx, (pt.y - pt.height / 2) * sy, pt.width * sx, pt.height * sy);
  }

  for (const tv of trafficVehicles) {
    minimapCtx.fillStyle = tv.color;
    minimapCtx.fillRect((tv.x - tv.width / 2) * sx, (tv.y - tv.height / 2) * sy, tv.width * sx, tv.height * sy);
  }

  // Player as yellow dot.
  minimapCtx.fillStyle = "#ffde21";
  minimapCtx.beginPath();
  minimapCtx.arc(player.x * sx, player.y * sy, 3.5, 0, Math.PI * 2);
  minimapCtx.fill();

  // Helicopter as a dark blue blinking dot (or solid)
  minimapCtx.fillStyle = "#0f3460";
  minimapCtx.beginPath();
  minimapCtx.arc(helicopter.x * sx, helicopter.y * sy, 4, 0, Math.PI * 2);
  minimapCtx.fill();
}

function getValidPlayerSpawn() {
  for (let attempts = 0; attempts < 100; attempts++) {
    const px = 350 + Math.random() * (world.width - 700);
    const py = 150 + Math.random() * (world.height - 300);
    if (isValidSpawn(px, py, 40, 20)) {
      return { x: px, y: py };
    }
  }
  return { x: world.width * 0.5, y: world.height * 0.5 };
}

function resetGame() {
  keys.w = false;
  keys.a = false;
  keys.s = false;
  keys.d = false;
  actions.toggleContainer = false;
  actions.honk = false;

  // Immovable first
  zones = buildZones();
  buildings = buildBuildings();
  setupShip();
  populateStaticContainers();

  // Movable next
  spawnParkedTrucks();
  spawnPedestrians(5);
  spawnSeagulls();
  spawnCones();

  // Player last
  const pSpawn = getValidPlayerSpawn();
  player.spawnX = pSpawn.x;
  player.spawnY = pSpawn.y;
  player.reset();
  trafficVehicles.length = 0;
  nextTrafficSpawnMs = performance.now() + 1000;
  lastTrafficCollisionAt = -Infinity;

  gameState = GAME_STATE.RUNNING;
  safetyViolations = 0;
  efficiencyScore = 50;
  lastHonkAt = -Infinity;
  missionStartMs = performance.now();
  feedbackUntil = 0;
  feedbackText = "";
  pendingNextTaskAt = -1;
  lastSpaceTapAt = -Infinity;
  gameOverMessage = "GAME OVER - FATAL ACCIDENT";
  activeTruck = null;
  reeferDeadlineMs = null;
  globalTimeLeft = 60;
  shiftTimeHours = 16.0;

  stopReverseAudio();
  generateNewTask();
}

function handleRestartTap(nowMs) {
  if (nowMs - lastSpaceTapAt <= RESTART_DOUBLE_TAP_MS) {
    resetGame();
    requestAnimationFrame(gameLoop);
    return;
  }
  lastSpaceTapAt = nowMs;
}

window.addEventListener("keydown", (event) => {
  unlockAudioOnFirstInteraction();
  const key = event.key.toLowerCase();
  const nowMs = performance.now();

  if (event.code === "Space" && !event.repeat) {
    event.preventDefault();
    if (gameState !== GAME_STATE.RUNNING) {
      handleRestartTap(nowMs);
      return;
    }
    actions.toggleContainer = true;
  }

  if (key in keys) {
    keys[key] = true;
    event.preventDefault();
  }

  if (key === "e" && !event.repeat && gameState === GAME_STATE.RUNNING) {
    actions.honk = true;
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key in keys) {
    keys[key] = false;
    event.preventDefault();
  }
});

function update(nowMs, dt) {
  handleHonk(nowMs);
  const previousX = player.x;
  const previousY = player.y;
  player.update(keys);
  handleContainerToggle(nowMs);
  checkReeferSpoilage(nowMs);

  for (const pedestrian of pedestrians) {
    pedestrian.update(dt, nowMs);
  }

  for (let i = exhaustParticles.length - 1; i >= 0; i--) {
    const p = exhaustParticles[i];
    p.update(dt);
    if (p.life <= 0 || p.alpha <= 0) {
      exhaustParticles.splice(i, 1);
    }
  }

  for (const seagull of seagulls) {
    seagull.update(dt);
  }

  for (const cone of trafficCones) {
    cone.update(dt);
  }

  helicopter.update(dt);

  if (pendingNextTaskAt > 0 && nowMs >= pendingNextTaskAt) {
    generateNewTask();
  }

  if (activeTruck && activeTruck.departing) {
    activeTruck.x += activeTruck.speed * dt;
    activeTruck.alpha -= 0.5 * dt;
    if (activeTruck.alpha <= 0) {
      activeTruck = null;
    }
  }

  if (nowMs >= nextTrafficSpawnMs) {
    const lanes = [
      { x: 40, dir: 1 },
      { x: 90, dir: 1 },
      { x: 150, dir: -1 },
      { x: 200, dir: -1 }
    ];
    const lane = lanes[Math.floor(Math.random() * lanes.length)];

    let canSpawn = true;
    const spawnY = lane.dir === 1 ? -70 : world.height + 70;

    for (const tv of trafficVehicles) {
      if (tv.x === lane.x) {
        if (Math.abs(tv.y - spawnY) < 250) {
          canSpawn = false;
          break;
        }
      }
    }

    if (canSpawn) {
      trafficVehicles.push(new TrafficVehicle(lane.x, lane.dir));
    }
    nextTrafficSpawnMs = nowMs + 1000 + Math.random() * 1000;
  }

  for (let i = trafficVehicles.length - 1; i >= 0; i--) {
    const tv = trafficVehicles[i];
    tv.update(dt);

    if ((tv.direction === 1 && tv.y > world.height + 100) ||
      (tv.direction === -1 && tv.y < -100)) {
      trafficVehicles.splice(i, 1);
    }
  }

  shiftTimeHours += dt * 0.05;
  if (shiftTimeHours >= 24) shiftTimeHours -= 24;

  globalTimeLeft -= dt;
  if (globalTimeLeft <= 0) {
    globalTimeLeft = 0;
    gameState = GAME_STATE.GAME_OVER;
    gameOverMessage = "GAME OVER - TIME'S UP";
    stopReverseAudio();
  }

  updateReverseAudio();
  updateFuelSystem(dt);
  updateHornWaves();
  checkNearMissViolations(nowMs);
  checkFatalCollision();

  // Traffic Collision
  const pRect = {
    x: player.x - player.width / 2,
    y: player.y - player.height / 2,
    width: player.width,
    height: player.height
  };

  if (nowMs - lastTrafficCollisionAt > 3000) {
    for (const tv of trafficVehicles) {
      if (rectsOverlap(pRect, tv.getRect())) {
        player.speed = 0;
        efficiencyScore -= 20;
        feedbackText = "TRAFFIC COLLISION! -20 Pts";
        feedbackColor = "#ff2b2b";
        feedbackUntil = nowMs + 2000;
        lastTrafficCollisionAt = nowMs;
        break;
      }
    }
  }

  // Dynamic Traffic Cones collision
  for (const cone of trafficCones) {
    if (rectCircleCollision(pRect, cone)) {
      const angle = Math.atan2(cone.y - player.y, cone.x - player.x);
      const pushForce = 300;
      cone.vx = Math.cos(angle) * pushForce;
      cone.vy = Math.sin(angle) * pushForce;
    }
  }

  updateCamera();
  updateOverlayUi(nowMs);
}

function render(nowMs) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawZones();
  drawInfrastructure(ctx, camera);
  drawBuildings(ctx, camera);

  for (const cone of trafficCones) {
    cone.draw(ctx, camera);
  }

  for (const boat of smallBoats) {
    boat.draw(ctx, camera);
  }

  for (const obstacle of staticContainers) {
    obstacle.draw(ctx, camera);
  }

  for (const particle of exhaustParticles) {
    particle.draw(ctx, camera);
  }

  taskContainer.draw(ctx, camera);

  if (activeTruck && activeTruck.active) {
    activeTruck.draw(ctx, camera);
  }
  for (const pt of parkedTrucks) {
    pt.draw(ctx, camera);
  }
  for (const tv of trafficVehicles) {
    tv.draw(ctx, camera);
  }
  for (const pedestrian of pedestrians) {
    pedestrian.draw(ctx, camera);
  }

  for (const seagull of seagulls) {
    seagull.draw(ctx, camera);
  }
  if (typeof helicopter !== "undefined") {
    helicopter.draw(ctx, camera);
  }
  drawHornWaves();
  player.draw(ctx, camera);
  drawReeferCountdown(nowMs);
  drawFloatingPrompt();
  drawFeedback(nowMs);
  drawLighting();
  drawMinimap();
}

function gameLoop(nowMs) {
  if (gameState !== GAME_STATE.RUNNING) {
    render(nowMs);
    drawGameOverOverlay();
    updateOverlayUi(nowMs);
    return;
  }

  const dt = Math.min((nowMs - lastFrameMs) / 1000, 0.05);
  lastFrameMs = nowMs;

  update(nowMs, dt);
  render(nowMs);
  requestAnimationFrame(gameLoop);
}

zones = buildZones();
buildings = buildBuildings();
setupShip();
populateStaticContainers();

spawnParkedTrucks();
spawnPedestrians(randomInt(3, 9));
spawnCones();
spawnSeagulls();

const pSpawn = getValidPlayerSpawn();
player.spawnX = pSpawn.x;
player.spawnY = pSpawn.y;
player.reset();

generateNewTask();
updateCamera();
requestAnimationFrame(gameLoop);
