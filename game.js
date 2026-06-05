/* ============================================================
   BALLOON RISE — Retro endless arcade balloon game
   Vanilla JS + Canvas API
   ============================================================ */

'use strict';

// ─── Constants ───────────────────────────────────────────────
const HIGH_SCORE_KEY = 'balloon_high_score';
const BALLOON_Y_RATIO = 0.7;
const INITIAL_LIVES = 1;
const COLORED_MODE_DURATION = 15;
const MAGNET_DURATION = 12;
const SHIELD_DURATION = 8;
const STRONGHOLD_DURATION = 12;
const INVULN_DURATION = 1;
const MAGNET_RADIUS = 180;

const PLATFORM_MIN_WIDTH = 60;
const PLATFORM_MAX_WIDTH_CAP = 300;
const MIN_PASSAGE_GAP = 100;
const EDGE_MARGIN = 30;

const BUBBLE_POINTS = 10;
const SPECIAL_POINTS = 100;
const MIN_BUBBLES_PER_WAVE = 3;
const MAX_BUBBLES_PER_WAVE = 6;
const BUBBLE_WAVE_INTERVAL = 2.8;
const BUBBLE_MIN_SPACING = 50;
const POWERUP_INTERVAL = 20;
const SPECIAL_BALL_INTERVAL = 30;

// ─── Utilities ─────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

// ─── AudioManager ──────────────────────────────────────────
class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._init();
  }

  _init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      this.ctx = null;
    }
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  _tone(freq, duration, type = 'square', vol = 0.08, slide = 0) {
    if (!this.ctx || this.muted) return;
    this._resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t + duration);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  collect() { this._tone(880, 0.08, 'square', 0.06); this._tone(1320, 0.06, 'square', 0.04); }
  special() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.1, 'sine', 0.07), i * 60));
  }
  powerup() { this._tone(440, 0.12, 'triangle', 0.08, 200); }
  hit() { this._tone(120, 0.25, 'sawtooth', 0.1, -60); }
  smash() { this._tone(180, 0.1, 'square', 0.09, -80); this._tone(90, 0.15, 'sawtooth', 0.07); }
  gameOver() {
    [392, 349, 294, 220].forEach((f, i) => setTimeout(() => this._tone(f, 0.2, 'square', 0.07), i * 150));
  }
}

// ─── Particle ──────────────────────────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = rand(-80, 80);
    this.vy = rand(-120, -40);
    this.life = 1;
    this.decay = rand(1.5, 3);
    this.size = rand(2, 5);
    this.color = color;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 200 * dt;
    this.life -= this.decay * dt;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.globalAlpha = clamp(this.life, 0, 1);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.globalAlpha = 1;
  }
}

// ─── ScorePopup ────────────────────────────────────────────
class ScorePopup {
  constructor(x, y, text, color = '#fff') {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1;
    this.vy = -60;
  }

  update(dt) {
    this.y += this.vy * dt;
    this.life -= dt * 1.2;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.globalAlpha = clamp(this.life, 0, 1);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 16px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1;
  }
}

// ─── Balloon ───────────────────────────────────────────────
class Balloon {
  constructor(screenW, screenH) {
    this.radius = 22;
    this.screenW = screenW;
    this.screenH = screenH;
    this.x = screenW / 2;
    this.y = screenH * BALLOON_Y_RATIO;
    this.targetX = this.x;
    this.velocity = 0;
    this.bobPhase = 0;
    this.colored = false;
    this.coloredTimer = 0;
    this.shield = false;
    this.shieldTimer = 0;
    this.magnet = false;
    this.magnetTimer = 0;
    this.stronghold = false;
    this.strongholdTimer = 0;
    this.invuln = false;
    this.invulnTimer = 0;
    this.flashPhase = 0;
    this.colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff8fab'];
    this.colorPhase = 0;
  }

  resize(screenW, screenH) {
    this.screenW = screenW;
    this.screenH = screenH;
    this.y = screenH * BALLOON_Y_RATIO;
    this.x = clamp(this.x, this.radius + 10, screenW - this.radius - 10);
    this.targetX = clamp(this.targetX, this.radius + 10, screenW - this.radius - 10);
  }

  setTarget(x) {
    this.targetX = clamp(x, this.radius + 10, this.screenW - this.radius - 10);
  }

  update(dt, keys) {
    const KEY_ACCEL = 2800;
    const KEY_MAX_SPEED = 900;
    const KEY_FRICTION = 0.86;
    const POINTER_RESPONSE = 32;

    const keyInput = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);

    if (keyInput !== 0) {
      this.velocity += keyInput * KEY_ACCEL * dt;
      this.velocity = clamp(this.velocity, -KEY_MAX_SPEED, KEY_MAX_SPEED);
      this.x += this.velocity * dt;
      this.targetX = this.x;
    } else {
      const smooth = 1 - Math.exp(-POINTER_RESPONSE * dt);
      this.x += (this.targetX - this.x) * smooth;
      this.velocity *= Math.pow(KEY_FRICTION, dt * 60);
      this.x += this.velocity * dt;
    }

    this.x = clamp(this.x, this.radius + 10, this.screenW - this.radius - 10);

    this.bobPhase += dt * 3;
    this.colorPhase += dt * 2;

    if (this.coloredTimer > 0) {
      this.coloredTimer -= dt;
      if (this.coloredTimer <= 0) this.colored = false;
    }
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) this.shield = false;
    }
    if (this.magnetTimer > 0) {
      this.magnetTimer -= dt;
      if (this.magnetTimer <= 0) this.magnet = false;
    }
    if (this.strongholdTimer > 0) {
      this.strongholdTimer -= dt;
      if (this.strongholdTimer <= 0) this.stronghold = false;
    }
    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      this.flashPhase += dt * 12;
      if (this.invulnTimer <= 0) this.invuln = false;
    }
  }

  activateColored() {
    this.colored = true;
    this.coloredTimer = COLORED_MODE_DURATION;
  }

  activateShield() {
    this.shield = true;
    this.shieldTimer = SHIELD_DURATION;
  }

  activateMagnet() {
    this.magnet = true;
    this.magnetTimer = MAGNET_DURATION;
  }

  activateStronghold() {
    this.stronghold = true;
    this.strongholdTimer = STRONGHOLD_DURATION;
  }

  triggerInvuln(duration = INVULN_DURATION) {
    this.invuln = true;
    this.invulnTimer = duration;
  }

  breakShield() {
    this.shield = false;
    this.shieldTimer = 0;
  }

  get hitRadius() { return this.radius - 4; }

  draw(ctx) {
    if (this.invuln && Math.floor(this.flashPhase) % 2 === 0) return;

    const bob = Math.sin(this.bobPhase) * 3;
    const drawY = this.y + bob;

    if (this.shield) {
      ctx.beginPath();
      ctx.arc(this.x, drawY, this.radius + 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200, 220, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.magnet) {
      ctx.beginPath();
      ctx.arc(this.x, drawY, MAGNET_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(160, 160, 160, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.stronghold) {
      const pulse = 1 + Math.sin(this.bobPhase * 2) * 0.08;
      ctx.beginPath();
      ctx.arc(this.x, drawY, (this.radius + 14) * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 220, 120, 0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + this.bobPhase;
        ctx.beginPath();
        ctx.moveTo(this.x + Math.cos(a) * (this.radius + 6), drawY + Math.sin(a) * (this.radius + 6));
        ctx.lineTo(this.x + Math.cos(a) * (this.radius + 18), drawY + Math.sin(a) * (this.radius + 18));
        ctx.strokeStyle = 'rgba(255, 200, 80, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const basketH = 14;
    const basketW = 18;
    const stringLen = 12;

    if (this.colored) {
      const c1 = this.colors[Math.floor(this.colorPhase) % this.colors.length];
      const c2 = this.colors[Math.floor(this.colorPhase + 1) % this.colors.length];
      const grad = ctx.createRadialGradient(this.x - 6, drawY - 8, 4, this.x, drawY, this.radius);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.shadowColor = c1;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(this.x, drawY, this.radius * 0.85, this.radius, 0, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath();
      ctx.ellipse(this.x, drawY, this.radius * 0.85, this.radius, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d0d0d0';
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(this.x - 8, drawY + this.radius - 4);
      ctx.lineTo(this.x, drawY + this.radius + stringLen);
      ctx.lineTo(this.x + 8, drawY + this.radius - 4);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = this.colored ? '#8b6914' : '#999';
    ctx.fillRect(this.x - basketW / 2, drawY + this.radius + stringLen, basketW, basketH);
    ctx.strokeStyle = this.colored ? '#5a4510' : '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x - basketW / 2, drawY + this.radius + stringLen, basketW, basketH);

    if (!this.colored) {
      ctx.beginPath();
      ctx.moveTo(this.x - 8, drawY + this.radius - 4);
      ctx.lineTo(this.x, drawY + this.radius + stringLen);
      ctx.lineTo(this.x + 8, drawY + this.radius - 4);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ─── Bubble ────────────────────────────────────────────────
class Bubble {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 10;
    this.phase = rand(0, Math.PI * 2);
    this.collected = false;
  }

  update(dt, scrollSpeed) {
    this.y += scrollSpeed * dt;
    this.phase += dt * 4;
  }

  draw(ctx) {
    const float = Math.sin(this.phase) * 4;
    const r = this.radius + Math.sin(this.phase * 1.5) * 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y + float, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.x - 3, this.y + float - 3, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
  }
}

// ─── SpecialBall ───────────────────────────────────────────
class SpecialBall {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 14;
    this.phase = rand(0, Math.PI * 2);
    this.collected = false;
    this.hue = randInt(0, 360);
  }

  update(dt, scrollSpeed) {
    this.y += scrollSpeed * dt;
    this.phase += dt * 5;
    this.hue = (this.hue + dt * 60) % 360;
  }

  draw(ctx) {
    const pulse = 1 + Math.sin(this.phase) * 0.15;
    const r = this.radius * pulse;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${this.hue}, 80%, 60%, 0.2)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${this.hue}, 90%, 65%)`;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ─── Platform ──────────────────────────────────────────────
class Platform {
  constructor(x, y, width) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = 18;
    this.spikeCount = Math.max(3, Math.floor(width / 18));
  }

  update(dt, scrollSpeed) {
    this.y += scrollSpeed * dt;
  }

  draw(ctx) {
    ctx.fillStyle = '#555';
    ctx.fillRect(this.x, this.y, this.width, this.height);

    const spikeW = this.width / this.spikeCount;
    ctx.fillStyle = '#888';
    for (let i = 0; i < this.spikeCount; i++) {
      const sx = this.x + i * spikeW;
      ctx.beginPath();
      ctx.moveTo(sx, this.y);
      ctx.lineTo(sx + spikeW / 2, this.y - 14);
      ctx.lineTo(sx + spikeW, this.y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.spikeCount; i++) {
      const sx = this.x + i * spikeW;
      ctx.beginPath();
      ctx.moveTo(sx, this.y);
      ctx.lineTo(sx + (i < this.spikeCount ? spikeW / 2 : 0), i < this.spikeCount ? this.y - 14 : this.y);
      ctx.stroke();
    }
  }

  get spikeTop() { return this.y - 14; }
}

// ─── Powerup ───────────────────────────────────────────────
const POWERUP_TYPES = {
  LIFE: 'life',
  MAGNET: 'magnet',
  SHIELD: 'shield',
  STRONGHOLD: 'stronghold',
};

const POWERUP_CYCLE = [
  POWERUP_TYPES.MAGNET,
  POWERUP_TYPES.SHIELD,
  POWERUP_TYPES.STRONGHOLD,
  POWERUP_TYPES.LIFE,
];

const POWERUP_LABELS = {
  [POWERUP_TYPES.LIFE]: 'LIFE',
  [POWERUP_TYPES.MAGNET]: 'MAGNET',
  [POWERUP_TYPES.SHIELD]: 'SHIELD',
  [POWERUP_TYPES.STRONGHOLD]: 'STRONG',
};

class Powerup {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.radius = 18;
    this.phase = rand(0, Math.PI * 2);
    this.collected = false;
  }

  update(dt, scrollSpeed) {
    this.y += scrollSpeed * dt;
    this.phase += dt * 3;
  }

  _drawBadge(ctx, fill, stroke, letter) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 13px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 0, 1);
  }

  draw(ctx) {
    const bob = Math.sin(this.phase) * 3;
    const y = this.y + bob;

    ctx.save();
    ctx.translate(this.x, y);

    if (this.type === POWERUP_TYPES.LIFE) {
      this._drawBadge(ctx, '#e8e8e8', '#888', '+');
    } else if (this.type === POWERUP_TYPES.MAGNET) {
      this._drawBadge(ctx, '#b8c8e8', '#6688bb', 'M');
      ctx.strokeStyle = '#334';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-6, -4, 7, Math.PI * 0.85, Math.PI * 1.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(6, -4, 7, Math.PI * 1.25, Math.PI * 0.25, true);
      ctx.stroke();
      ctx.fillStyle = '#c44';
      ctx.fillRect(-7, -4, 5, 5);
      ctx.fillStyle = '#44c';
      ctx.fillRect(2, -4, 5, 5);
    } else if (this.type === POWERUP_TYPES.SHIELD) {
      this._drawBadge(ctx, '#c8d8e8', '#7799aa', 'S');
      ctx.strokeStyle = '#556';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(10, -5);
      ctx.lineTo(10, 3);
      ctx.quadraticCurveTo(0, 12, -10, 3);
      ctx.lineTo(-10, -5);
      ctx.closePath();
      ctx.stroke();
    } else if (this.type === POWERUP_TYPES.STRONGHOLD) {
      this._drawBadge(ctx, '#e8d8a8', '#aa8844', 'H');
      ctx.strokeStyle = '#664';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 4);
      ctx.lineTo(-10, -6);
      ctx.lineTo(0, -10);
      ctx.lineTo(10, -6);
      ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(0, -2);
      ctx.lineTo(0, 6);
      ctx.stroke();
    }

    ctx.fillStyle = '#ccc';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(POWERUP_LABELS[this.type], 0, this.radius + 12);

    ctx.restore();
  }
}

// ─── CollisionManager ──────────────────────────────────────
class CollisionManager {
  static checkBalloonBubble(balloon, bubble) {
    const bob = Math.sin(balloon.bobPhase) * 3;
    const float = Math.sin(bubble.phase) * 4;
    const dx = balloon.x - bubble.x;
    const dy = (balloon.y + bob) - (bubble.y + float);
    return dx * dx + dy * dy < (balloon.hitRadius + bubble.radius) ** 2;
  }

  static checkBalloonCircle(balloon, obj) {
    const bob = Math.sin(balloon.bobPhase) * 3;
    const dx = balloon.x - obj.x;
    const dy = (balloon.y + bob) - obj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < balloon.hitRadius + (obj.radius || 14);
  }

  static checkBalloonPlatform(balloon, platform) {
    const bob = Math.sin(balloon.bobPhase) * 3;
    const by = balloon.y + bob;
    const br = balloon.hitRadius;

    if (by + br < platform.spikeTop) return false;
    if (by - br > platform.y + platform.height) return false;
    if (balloon.x + br < platform.x) return false;
    if (balloon.x - br > platform.x + platform.width) return false;

    for (let i = 0; i < platform.spikeCount; i++) {
      const spikeW = platform.width / platform.spikeCount;
      const sx = platform.x + i * spikeW + spikeW / 2;
      const spikeR = 8;
      const dx = balloon.x - sx;
      const dy = by - (platform.y - 7);
      if (dx * dx + dy * dy < (br + spikeR) * (br + spikeR)) return true;
    }

    if (by + br > platform.y && balloon.x > platform.x && balloon.x < platform.x + platform.width) {
      return true;
    }

    return false;
  }
}

// ─── WorldSpawner ────────────────────────────────────────────
class WorldSpawner {
  constructor(screenW) {
    this.screenW = screenW;
    this.distanceSinceRow = 0;
    this.difficulty = 0;
    this.baseRowSpacing = 220;
    this.initialGrace = 280;
    this.powerupTimer = 0;
    this.specialTimer = 0;
    this.bubbleWaveTimer = 0;
    this.powerupCycleIndex = 0;
  }

  resize(screenW) {
    this.screenW = screenW;
  }

  get maxPlatformWidth() {
    return Math.min(this.screenW * 0.5, PLATFORM_MAX_WIDTH_CAP);
  }

  setDifficulty(d) {
    this.difficulty = clamp(d, 0, 1);
    this.baseRowSpacing = lerp(280, 140, this.difficulty);
  }

  _generatePlatforms(y) {
    const maxW = this.maxPlatformWidth;
    const minGap = MIN_PASSAGE_GAP;
    const margin = EDGE_MARGIN;
    const usable = this.screenW - margin * 2;

    if (Math.random() < lerp(0.25, 0.08, this.difficulty)) return [];

    const twoChance = lerp(0.1, 0.45, this.difficulty);
    const useTwo = usable > minGap + PLATFORM_MIN_WIDTH * 2 + 40 && Math.random() < twoChance;

    if (useTwo) {
      const gap = minGap + rand(10, 50);
      const w1 = randInt(PLATFORM_MIN_WIDTH, Math.min(maxW, Math.floor(usable * 0.38)));
      const w2 = randInt(PLATFORM_MIN_WIDTH, Math.min(maxW, Math.floor(usable * 0.38)));
      const leftover = usable - w1 - w2 - gap;
      if (leftover < 0) return this._generateSingle(y, maxW, minGap, margin);

      const x1 = margin + randInt(0, Math.max(0, Math.floor(leftover * 0.6)));
      const x2 = x1 + w1 + gap;
      if (x2 + w2 > this.screenW - margin) {
        const shift = x2 + w2 - (this.screenW - margin);
        const nx1 = Math.max(margin, x1 - shift);
        const nx2 = nx1 + w1 + gap;
        if (nx2 + w2 <= this.screenW - margin) {
          return [
            new Platform(nx1, y, w1),
            new Platform(nx2, y, w2),
          ];
        }
        return this._generateSingle(y, maxW, minGap, margin);
      }
      return [new Platform(x1, y, w1), new Platform(x2, y, w2)];
    }

    return this._generateSingle(y, maxW, minGap, margin);
  }

  _generateSingle(y, maxW, minGap, margin) {
    const width = randInt(PLATFORM_MIN_WIDTH, Math.floor(maxW));
    const maxX = this.screenW - margin - width;
    const minX = margin;

    const gapLeft = rand(minGap, this.screenW * 0.55);
    const gapRight = this.screenW - gapLeft;

    let x;
    if (gapLeft >= minGap && gapRight >= width + margin) {
      const placeRight = Math.random() < 0.5;
      if (placeRight) {
        x = randInt(Math.ceil(gapLeft), maxX);
      } else {
        x = randInt(minX, Math.floor(gapRight - width - margin));
      }
    } else {
      x = randInt(minX, maxX);
    }

    x = clamp(x, minX, maxX);
    return [new Platform(x, y, width)];
  }

  _randomX(margin = 40) {
    return rand(margin, this.screenW - margin);
  }

  _spawnBubbleWave(entities) {
    const count = randInt(MIN_BUBBLES_PER_WAVE, MAX_BUBBLES_PER_WAVE);
    const placed = [];

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const bx = this._randomX(25);
        const by = -rand(100, 320);

        if (this._overlapsPlatform(bx, by, entities.platforms)) continue;

        let tooClose = false;
        for (const p of placed) {
          const dx = bx - p.x;
          const dy = by - p.y;
          if (dx * dx + dy * dy < BUBBLE_MIN_SPACING * BUBBLE_MIN_SPACING) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        entities.bubbles.push(new Bubble(bx, by));
        placed.push({ x: bx, y: by });
        break;
      }
    }
  }

  _spawnAboveScreen(entities, type) {
    const spawnY = -rand(50, 110);
    const x = this._randomX();

    if (type === 'special') {
      entities.specials.push(new SpecialBall(x, spawnY));
      return;
    }

    const powerupType = POWERUP_CYCLE[this.powerupCycleIndex % POWERUP_CYCLE.length];
    this.powerupCycleIndex++;
    entities.powerups.push(new Powerup(x, spawnY, powerupType));
  }

  tick(dt, scrollSpeed, entities) {
    this.distanceSinceRow += scrollSpeed * dt;

    while (this.distanceSinceRow >= this.baseRowSpacing) {
      this.distanceSinceRow -= this.baseRowSpacing + rand(-30, 50);

      const spawnY = -rand(50, 120);

      const platforms = this._generatePlatforms(spawnY);
      entities.platforms.push(...platforms);
    }

    this.bubbleWaveTimer += dt;
    while (this.bubbleWaveTimer >= BUBBLE_WAVE_INTERVAL) {
      this.bubbleWaveTimer -= BUBBLE_WAVE_INTERVAL;
      this._spawnBubbleWave(entities);
    }

    this.powerupTimer += dt;
    while (this.powerupTimer >= POWERUP_INTERVAL) {
      this.powerupTimer -= POWERUP_INTERVAL;
      this._spawnAboveScreen(entities, 'powerup');
    }

    this.specialTimer += dt;
    while (this.specialTimer >= SPECIAL_BALL_INTERVAL) {
      this.specialTimer -= SPECIAL_BALL_INTERVAL;
      this._spawnAboveScreen(entities, 'special');
    }
  }

  _overlapsPlatform(x, y, platforms) {
    for (const p of platforms) {
      if (Math.abs(p.y - y) > 60) continue;
      if (x > p.x - 20 && x < p.x + p.width + 20) return true;
    }
    return false;
  }

  reset() {
    this.distanceSinceRow = -this.initialGrace;
    this.difficulty = 0;
    this.baseRowSpacing = 220;
    this.powerupTimer = 0;
    this.specialTimer = 0;
    this.bubbleWaveTimer = 0;
    this.powerupCycleIndex = 0;
  }
}

// ─── UIManager ───────────────────────────────────────────────
class UIManager {
  constructor() {
    this.scoreEl = document.getElementById('score-display');
    this.highScoreEl = document.getElementById('high-score-display');
    this.livesEl = document.getElementById('lives-display');
    this.powerupEl = document.getElementById('powerup-display');
    this.coloredTimerEl = document.getElementById('colored-timer');
    this.coloredBarFill = document.getElementById('colored-bar-fill');
    this.coloredTimeEl = document.getElementById('colored-time');

    this.hud = document.getElementById('hud');
    this.statusBar = document.getElementById('status-bar');
    this.startScreen = document.getElementById('start-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.gameoverScreen = document.getElementById('gameover-screen');

    this.startHighScore = document.getElementById('start-high-score');
    this.finalScore = document.getElementById('final-score');
    this.gameoverHighScore = document.getElementById('gameover-high-score');
  }

  showStart(highScore) {
    this.startScreen.classList.remove('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameoverScreen.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.statusBar.classList.add('hidden');
    this.startHighScore.textContent = highScore;
  }

  showPlaying() {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameoverScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.statusBar.classList.remove('hidden');
  }

  showPause() {
    this.pauseScreen.classList.remove('hidden');
  }

  hidePause() {
    this.pauseScreen.classList.add('hidden');
  }

  showGameOver(score, highScore) {
    this.gameoverScreen.classList.remove('hidden');
    this.finalScore.textContent = score;
    this.gameoverHighScore.textContent = highScore;
  }

  updateScore(score) {
    this.scoreEl.textContent = score;
  }

  updateHighScore(hs) {
    this.highScoreEl.textContent = hs;
  }

  updateLives(lives, maxLives) {
    this.livesEl.innerHTML = '';
    for (let i = 0; i < maxLives; i++) {
      const el = document.createElement('div');
      el.className = 'life-icon' + (i >= lives ? ' empty' : '');
      this.livesEl.appendChild(el);
    }
  }

  updatePowerups(balloon) {
    this.powerupEl.innerHTML = '';
    if (balloon.shield) {
      this._badge('🛡', `SHIELD ${Math.ceil(balloon.shieldTimer)}s`);
    }
    if (balloon.magnet) {
      this._badge('🧲', `MAGNET ${Math.ceil(balloon.magnetTimer)}s`);
    }
    if (balloon.stronghold) {
      this._badge('💪', `STRONG ${Math.ceil(balloon.strongholdTimer)}s`);
    }
  }

  _badge(icon, text) {
    const el = document.createElement('div');
    el.className = 'powerup-badge';
    el.innerHTML = `<span class="badge-icon">${icon}</span><span>${text}</span>`;
    this.powerupEl.appendChild(el);
  }

  updateColoredTimer(balloon) {
    if (balloon.colored && balloon.coloredTimer > 0) {
      this.coloredTimerEl.classList.remove('hidden');
      const pct = (balloon.coloredTimer / COLORED_MODE_DURATION) * 100;
      this.coloredBarFill.style.width = pct + '%';
      this.coloredTimeEl.textContent = Math.ceil(balloon.coloredTimer);
    } else {
      this.coloredTimerEl.classList.add('hidden');
    }
  }
}

// ─── Game ────────────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new AudioManager();
    this.ui = new UIManager();

    this.state = 'start';
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || '0', 10);
    this.lives = INITIAL_LIVES;
    this.maxLives = 5;

    this.scrollSpeed = 120;
    this.baseScrollSpeed = 120;
    this.maxScrollSpeed = 320;
    this.playTime = 0;
    this.shakeTimer = 0;
    this.shakeIntensity = 0;

    this.keys = { left: false, right: false };
    this.pointerDown = false;

    this.balloon = null;
    this.spawner = null;
    this.entities = { platforms: [], bubbles: [], specials: [], powerups: [] };
    this.particles = [];
    this.popups = [];

    this.lastTime = 0;
    this.accumulator = 0;
    this.fixedDt = 1 / 60;

    this._bindEvents();
    this._resize();
    this.ui.showStart(this.highScore);
    this.ui.updateHighScore(this.highScore);
    requestAnimationFrame((t) => this._loop(t));
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.screenW = w;
    this.screenH = h;
    if (this.balloon) this.balloon.resize(w, h);
    if (this.spawner) this.spawner.resize(w);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());

    document.getElementById('start-btn').addEventListener('click', () => this.start());
    document.getElementById('play-again-btn').addEventListener('click', () => this.start());
    document.getElementById('resume-btn').addEventListener('click', () => this.resume());
    document.getElementById('restart-pause-btn').addEventListener('click', () => this.start());
    document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());

    document.getElementById('mute-btn').addEventListener('click', (e) => {
      const muted = this.audio.toggleMute();
      e.currentTarget.textContent = muted ? '🔇' : '🔊';
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { this.keys.left = true; e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.keys.right = true; e.preventDefault(); }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.state === 'playing') this.togglePause();
        else if (this.state === 'paused') this.resume();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') this.keys.left = false;
      if (e.key === 'ArrowRight') this.keys.right = false;
    });

    const pointerMove = (clientX) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      if (this.balloon) this.balloon.setTarget(x);
    };

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.state === 'playing') pointerMove(e.clientX);
    });

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.pointerDown = true;
      if (this.state === 'playing' && e.touches[0]) pointerMove(e.touches[0].clientX);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (this.state === 'playing' && e.touches[0]) pointerMove(e.touches[0].clientX);
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => { this.pointerDown = false; });
  }

  start() {
    this.state = 'playing';
    this.score = 0;
    this.lives = INITIAL_LIVES;
    this.scrollSpeed = this.baseScrollSpeed;
    this.playTime = 0;
    this.shakeTimer = 0;
    this.entities = { platforms: [], bubbles: [], specials: [], powerups: [] };
    this.particles = [];
    this.popups = [];
    this.keys = { left: false, right: false };

    this.balloon = new Balloon(this.screenW, this.screenH);
    this.spawner = new WorldSpawner(this.screenW);
    this.spawner.reset();

    this.ui.showPlaying();
    this.ui.updateScore(0);
    this.ui.updateLives(this.lives, Math.max(INITIAL_LIVES, this.lives));
    this.ui.updateHighScore(this.highScore);
    this.lastTime = performance.now();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.ui.showPause();
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.hidePause();
      this.lastTime = performance.now();
    }
  }

  _loop(timestamp) {
    const rawDt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    if (this.state === 'playing') {
      this.accumulator += rawDt;
      while (this.accumulator >= this.fixedDt) {
        this._update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }
    }

    this._draw();
    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    this.playTime += dt;
    const difficulty = clamp(this.playTime / 120, 0, 1);
    this.spawner.setDifficulty(difficulty);
    this.scrollSpeed = lerp(this.baseScrollSpeed, this.maxScrollSpeed, difficulty);

    this.balloon.update(dt, this.keys);
    this.spawner.tick(dt, this.scrollSpeed, this.entities);

    if (this.balloon.magnet) this._applyMagnet(dt);

    this._updateEntities(dt);
    this._checkCollisions();

    this.particles.forEach((p) => p.update(dt));
    this.particles = this.particles.filter((p) => p.life > 0);

    this.popups.forEach((p) => p.update(dt));
    this.popups = this.popups.filter((p) => p.life > 0);

    if (this.shakeTimer > 0) this.shakeTimer -= dt;

    this.ui.updateScore(this.score);
    this.ui.updateLives(this.lives, Math.max(INITIAL_LIVES, this.lives));
    this.ui.updatePowerups(this.balloon);
    this.ui.updateColoredTimer(this.balloon);
  }

  _applyMagnet(dt) {
    const bx = this.balloon.x;
    const by = this.balloon.y;
    const pull = 520;

    for (const bubble of this.entities.bubbles) {
      if (bubble.collected) continue;
      const dx = bx - bubble.x;
      const dy = by - bubble.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAGNET_RADIUS && dist > 1) {
        const force = pull * (1 - dist / MAGNET_RADIUS) * dt;
        bubble.x += (dx / dist) * force;
        bubble.y += (dy / dist) * force;
      }
    }

    for (const special of this.entities.specials) {
      if (special.collected) continue;
      const dx = bx - special.x;
      const dy = by - special.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAGNET_RADIUS * 0.7 && dist > 1) {
        const force = pull * 0.6 * (1 - dist / (MAGNET_RADIUS * 0.7)) * dt;
        special.x += (dx / dist) * force;
        special.y += (dy / dist) * force;
      }
    }
  }

  _updateEntities(dt) {
    const off = this.screenH + 60;
    const scroll = this.scrollSpeed;

    for (const arr of [this.entities.platforms, this.entities.bubbles,
      this.entities.specials, this.entities.powerups]) {
      for (const e of arr) e.update(dt, scroll);
      arr.splice(0, arr.length, ...arr.filter((e) => e.y < off));
    }
  }

  _checkCollisions() {
    if (!this.balloon.invuln) {
      for (let i = this.entities.platforms.length - 1; i >= 0; i--) {
        const platform = this.entities.platforms[i];
        if (!CollisionManager.checkBalloonPlatform(this.balloon, platform)) continue;

        if (this.balloon.stronghold) {
          this._breakPlatform(platform, i);
          continue;
        }

        this._handleHit();
        return;
      }
    }

    this._collectItems();
  }

  _breakPlatform(platform, index) {
    const cx = platform.x + platform.width / 2;
    const cy = platform.y;
    this.entities.platforms.splice(index, 1);
    this.audio.smash();
    this.shakeTimer = 0.15;
    this.shakeIntensity = 4;
    this._spawnParticles(cx, cy, '#aaa', 14);
    this._spawnParticles(cx, cy, '#666', 8);
    this.popups.push(new ScorePopup(cx, cy - 20, 'SMASH!', '#fd6'));
    this.balloon.triggerInvuln(0.2);
  }

  _collectItems() {
    for (const bubble of this.entities.bubbles) {
      if (bubble.collected) continue;
      if (CollisionManager.checkBalloonBubble(this.balloon, bubble)) {
        bubble.collected = true;
        this.score += BUBBLE_POINTS;
        this.audio.collect();
        this.popups.push(new ScorePopup(bubble.x, bubble.y, '+10'));
        this._spawnParticles(bubble.x, bubble.y, '#ccc', 6);
      }
    }
    this.entities.bubbles = this.entities.bubbles.filter((b) => !b.collected);

    for (const special of this.entities.specials) {
      if (special.collected) continue;
      if (CollisionManager.checkBalloonCircle(this.balloon, special)) {
        special.collected = true;
        this.score += SPECIAL_POINTS;
        this.balloon.activateColored();
        this.audio.special();
        this.popups.push(new ScorePopup(special.x, special.y, '+100', '#ffd93d'));
        this._spawnParticles(special.x, special.y, `hsl(${special.hue}, 80%, 70%)`, 12);
      }
    }
    this.entities.specials = this.entities.specials.filter((s) => !s.collected);

    for (const powerup of this.entities.powerups) {
      if (powerup.collected) continue;
      if (CollisionManager.checkBalloonCircle(this.balloon, powerup)) {
        powerup.collected = true;
        this.audio.powerup();
        this._spawnParticles(powerup.x, powerup.y, '#fff', 8);

        if (powerup.type === POWERUP_TYPES.LIFE) {
          this.lives = Math.min(this.lives + 1, this.maxLives);
          this.popups.push(new ScorePopup(powerup.x, powerup.y, '+1 LIFE', '#6f6'));
        } else if (powerup.type === POWERUP_TYPES.MAGNET) {
          this.balloon.activateMagnet();
          this.popups.push(new ScorePopup(powerup.x, powerup.y, 'MAGNET!', '#aaf'));
        } else if (powerup.type === POWERUP_TYPES.SHIELD) {
          this.balloon.activateShield();
          this.popups.push(new ScorePopup(powerup.x, powerup.y, 'SHIELD!', '#adf'));
        } else if (powerup.type === POWERUP_TYPES.STRONGHOLD) {
          this.balloon.activateStronghold();
          this.popups.push(new ScorePopup(powerup.x, powerup.y, 'STRONG HOLD!', '#fc6'));
        }
      }
    }
    this.entities.powerups = this.entities.powerups.filter((p) => !p.collected);
  }

  _handleHit() {
    this.audio.hit();
    this.shakeTimer = 0.35;
    this.shakeIntensity = 8;

    if (this.balloon.shield) {
      this.balloon.breakShield();
      this.balloon.triggerInvuln();
      this.popups.push(new ScorePopup(this.balloon.x, this.balloon.y - 30, 'SHIELD BREAK'));
      return;
    }

    this.lives--;
    this.balloon.triggerInvuln();

    if (this.lives <= 0) {
      this._gameOver();
    }
  }

  _gameOver() {
    this.state = 'gameover';
    this.audio.gameOver();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
    }
    this.ui.updateHighScore(this.highScore);
    this.ui.showGameOver(this.score, this.highScore);
  }

  _spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  _draw() {
    const ctx = this.ctx;
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTimer > 0) {
      shakeX = rand(-this.shakeIntensity, this.shakeIntensity);
      shakeY = rand(-this.shakeIntensity, this.shakeIntensity);
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    this._drawBackground(ctx);

    if (this.balloon) {
      for (const p of this.entities.platforms) p.draw(ctx);
      for (const b of this.entities.bubbles) b.draw(ctx);
      for (const s of this.entities.specials) s.draw(ctx);
      for (const p of this.entities.powerups) p.draw(ctx);
      this.balloon.draw(ctx);
      for (const p of this.particles) p.draw(ctx);
      for (const p of this.popups) p.draw(ctx);
    }

    if (this.state === 'start') {
      this._drawIdleScene(ctx);
    }

    ctx.restore();
  }

  _drawBackground(ctx) {
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.3)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    const offset = (this.playTime * this.scrollSpeed * 0.3) % gridSize;

    for (let y = -gridSize + offset; y < this.screenH; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.screenW, y);
      ctx.stroke();
    }
    for (let x = 0; x < this.screenW; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.screenH);
      ctx.stroke();
    }
  }

  _drawIdleScene(ctx) {
    const cx = this.screenW / 2;
    const cy = this.screenH * BALLOON_Y_RATIO;
    const bob = Math.sin(performance.now() / 500) * 4;

    ctx.beginPath();
    ctx.ellipse(cx, cy + bob, 20, 24, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d0d0d0';
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ─── Boot ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
