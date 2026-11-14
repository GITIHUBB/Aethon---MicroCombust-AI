'use client';

import { useEffect, useRef } from 'react';

const MAX_PARTICLES = 160;
const SPRITE_SIZE = 64;

/** Helper to pre-render radial gradient particle sprites to offscreen canvases */
function createParticleSprite(innerColor, midColor, outerColor) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = SPRITE_SIZE / 2;
  const radius = SPRITE_SIZE / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.35, midColor);
  gradient.addColorStop(0.7, outerColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return canvas;
}

export default function FlameCanvas({ gravity = '0g', flareSignal = 0 }) {
  const starsCanvasRef = useRef(null);
  const flameCanvasRef = useRef(null);
  const stateRef = useRef({
    gravityVal: 0,
    flare: 0,
    targetFlare: 0,
  });

  // Update gravity & flare state
  useEffect(() => {
    stateRef.current.gravityVal = parseFloat(gravity) || 0;
  }, [gravity]);

  useEffect(() => {
    if (flareSignal > 0) {
      stateRef.current.targetFlare = Math.min(1.5, stateRef.current.targetFlare + 0.6);
    }
  }, [flareSignal]);

  useEffect(() => {
    const starCanvas = starsCanvasRef.current;
    const flameCanvas = flameCanvasRef.current;
    if (!starCanvas || !flameCanvas) return;

    const sx = starCanvas.getContext('2d', { alpha: true });
    const fc = flameCanvas.getContext('2d', { alpha: true });
    if (!sx || !fc) return;

    // Pre-render hardware-accelerated particle sprites once:
    // 0: Hot Core (White-Amber)
    const coreSprite = createParticleSprite(
      'rgba(255, 255, 255, 1)',
      'rgba(254, 215, 170, 0.85)',
      'rgba(249, 115, 22, 0.25)'
    );
    // 1: NASA Aerospace Orange Flame
    const flameSprite = createParticleSprite(
      'rgba(255, 170, 50, 0.95)',
      'rgba(249, 115, 22, 0.75)',
      'rgba(194, 65, 12, 0.15)'
    );
    // 2: Deep Red/Amber Ember
    const emberSprite = createParticleSprite(
      'rgba(251, 113, 133, 0.8)',
      'rgba(225, 29, 72, 0.5)',
      'rgba(136, 19, 55, 0)'
    );
    // 3: Microgravity Cyan / Cool Flame
    const cyanSprite = createParticleSprite(
      'rgba(207, 250, 254, 0.95)',
      'rgba(6, 182, 212, 0.7)',
      'rgba(14, 116, 144, 0.15)'
    );

    const sprites = [coreSprite, flameSprite, emberSprite, cyanSprite].filter(Boolean);

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = window.innerWidth;
    let H = window.innerHeight;

    // Fixed particle pool to prevent garbage collection pauses
    const pool = new Array(MAX_PARTICLES).fill(null).map(() => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 10,
      spriteIndex: 0,
    }));

    // Mouse & state tracker
    const mouse = {
      x: W / 2,
      y: H / 2,
      px: W / 2,
      py: H / 2,
      speed: 0,
      inside: true,
      isInteracting: false,
    };

    // Stars data
    let stars = [];
    const STAR_PALETTE = ['#ffffff', '#bae6fd', '#fed7aa', '#e2e8f0'];

    const initStars = () => {
      const count = Math.min(Math.round((W * H) / 7000), 180);
      stars = new Array(count).fill(null).map(() => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.2 + 0.3,
        alpha: Math.random() * 0.7 + 0.2,
        speed: Math.random() * 0.015 + 0.005,
        phase: Math.random() * Math.PI * 2,
        color: STAR_PALETTE[(Math.random() * STAR_PALETTE.length) | 0],
      }));
    };

    const handleResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      starCanvas.width = Math.round(W * dpr);
      starCanvas.height = Math.round(H * dpr);
      flameCanvas.width = Math.round(W * dpr);
      flameCanvas.height = Math.round(H * dpr);

      sx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fc.setTransform(dpr, 0, 0, dpr, 0, 0);

      initStars();
    };

    handleResize();

    const onPointerMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.inside = true;
    };

    const onPointerDown = () => {
      mouse.isInteracting = true;
    };

    const onPointerUp = () => {
      mouse.isInteracting = false;
    };

    const onPointerLeave = () => {
      mouse.inside = false;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);

    let rafId = 0;
    let lastTime = performance.now();
    let starRenderThrottle = 0;

    const render = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;

      // Mouse speed calculation
      const dist = Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py);
      mouse.speed += (dist / Math.max(dt, 0.001) / 1200 - mouse.speed) * 0.2;
      mouse.px = mouse.x;
      mouse.py = mouse.y;

      // Flare decay
      const sState = stateRef.current;
      sState.flare += (sState.targetFlare - sState.flare) * 0.15;
      sState.targetFlare *= 0.95;

      // 1. Starfield Update (rendered at 30fps throttle for max performance)
      starRenderThrottle += dt;
      if (starRenderThrottle >= 0.033) {
        starRenderThrottle = 0;
        sx.clearRect(0, 0, W, H);
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.phase += s.speed;
          const a = s.alpha * (0.6 + 0.4 * Math.sin(s.phase));
          sx.globalAlpha = a;
          sx.fillStyle = s.color;
          sx.beginPath();
          sx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          sx.fill();
        }
        sx.globalAlpha = 1;
      }

      // 2. Spawn Flame Particles when mouse is inside
      const isZeroG = sState.gravityVal === 0;
      const isLunar = sState.gravityVal > 0 && sState.gravityVal < 0.5;
      const buoyancy = isZeroG ? 0 : isLunar ? 0.35 : 1.0;
      const activity = Math.min(1.5, mouse.speed * 1.2 + (mouse.isInteracting ? 0.8 : 0) + sState.flare);
      const spawnCount = mouse.inside ? Math.min(5, Math.floor(activity * 4 + 1)) : 0;

      for (let s = 0; s < spawnCount; s++) {
        // Find first dead particle in pool
        const p = pool.find((item) => !item.active);
        if (!p) break;

        p.active = true;
        p.life = 0;
        p.maxLife = 0.4 + Math.random() * 0.45;

        // In 0g microgravity, flame is spherical diffusion with occasional cyan cold-flame radical
        const angle = Math.random() * Math.PI * 2;
        const speed = isZeroG ? (15 + Math.random() * 40) : (25 + Math.random() * 55);

        p.x = mouse.x + (Math.random() - 0.5) * 8;
        p.y = mouse.y + (Math.random() - 0.5) * 8;

        if (isZeroG) {
          // Spherical dispersion in 0g
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
          // Randomly use cyan radical sprite for cold flame / 0g signature
          p.spriteIndex = Math.random() < 0.35 ? 3 : Math.random() < 0.6 ? 1 : 0;
        } else {
          // Buoyant plume rise in gravity
          p.vx = (Math.random() - 0.5) * 35;
          p.vy = -(40 + Math.random() * 70) * buoyancy;
          p.spriteIndex = Math.random() < 0.4 ? 1 : Math.random() < 0.7 ? 0 : 2;
        }

        p.size = (14 + Math.random() * 16) * (1 + activity * 0.3);
      }

      // 3. Render Active Particles
      fc.clearRect(0, 0, W, H);
      fc.globalCompositeOperation = 'lighter';

      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;

        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          continue;
        }

        // Physics integration
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;

        if (!isZeroG) {
          // Upward buoyant acceleration
          p.vy -= 40 * buoyancy * dt;
        }

        const progress = p.life / p.maxLife;
        // Fade out smoothly
        const alpha = Math.max(0, Math.sin(progress * Math.PI) * 0.85);
        const currentSize = p.size * (0.8 + progress * 0.4);

        const sprite = sprites[p.spriteIndex] || sprites[0];
        if (sprite && alpha > 0.01) {
          fc.globalAlpha = alpha;
          fc.drawImage(
            sprite,
            p.x - currentSize / 2,
            p.y - currentSize / 2,
            currentSize,
            currentSize
          );
        }
      }

      fc.globalCompositeOperation = 'source-over';
      fc.globalAlpha = 1;

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return (
    <>
      <canvas
        ref={starsCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-0"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      />
      <canvas
        ref={flameCanvasRef}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-10"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      />
    </>
  );
}
