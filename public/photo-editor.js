// 사진 편집기: 크기 줄이기 + 드래그해서 모자이크 + 되돌리기 (선생님 등록·학생 등록 공용)
export function photoEditor(canvas, { max = 1280, onDragStart } = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let has = false, stack = [], drag = null, snap = null;

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  };
  canvas.addEventListener('pointerdown', e => {
    if (!has) return;
    canvas.setPointerCapture(e.pointerId);
    drag = pos(e);
    snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    onDragStart?.();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = pos(e);
    ctx.putImageData(snap, 0, 0);
    ctx.fillStyle = 'rgba(0,113,227,.18)';
    ctx.fillRect(drag.x, drag.y, p.x - drag.x, p.y - drag.y);
    ctx.lineWidth = Math.max(2, canvas.width / 320); ctx.strokeStyle = '#fff';
    ctx.strokeRect(drag.x, drag.y, p.x - drag.x, p.y - drag.y);
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const p = pos(e);
    ctx.putImageData(snap, 0, 0);
    const x = Math.max(0, Math.min(drag.x, p.x)), y = Math.max(0, Math.min(drag.y, p.y));
    const w = Math.min(canvas.width - x, Math.abs(p.x - drag.x)), h = Math.min(canvas.height - y, Math.abs(p.y - drag.y));
    drag = null;
    if (w < 8 || h < 8) return;
    stack.push(snap);
    pixelate(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  });

  function pixelate(x, y, w, h) {
    const block = Math.max(12, Math.round(canvas.width / 35));
    const d = ctx.getImageData(x, y, w, h).data;
    for (let by = 0; by < h; by += block) for (let bx = 0; bx < w; bx += block) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = by; yy < Math.min(by + block, h); yy++) for (let xx = bx; xx < Math.min(bx + block, w); xx++) {
        const i = (yy * w + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      ctx.fillStyle = `rgb(${r / n | 0},${g / n | 0},${b / n | 0})`;
      ctx.fillRect(x + bx, y + by, Math.min(block, w - bx), Math.min(block, h - by));
    }
  }

  return {
    get hasPhoto() { return has; },
    async load(file) {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      has = true; stack = [];
    },
    undo() { if (stack.length) ctx.putImageData(stack.pop(), 0, 0); },
    reset() { has = false; stack = []; },
    toBlob: () => new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85)),
    toDataUrl(size = 640) {
      const small = document.createElement('canvas');
      const s = Math.min(1, size / Math.max(canvas.width, canvas.height));
      small.width = canvas.width * s; small.height = canvas.height * s;
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
      return small.toDataURL('image/jpeg', 0.75);
    },
  };
}
