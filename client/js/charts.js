import { dateBR, esc, qty } from './ui.js';

function scale(values) {
  const max = Math.max(...values, 1);
  return max;
}

export function lineChart(points, color = '#ec1f28') {
  if (!points?.length) return '<p class="empty">Sem série no período.</p>';
  const width = 640;
  const height = 220;
  const pad = { l: 36, r: 10, t: 16, b: 28 };
  const max = scale(points.map((point) => point.qty ?? point.value ?? 0));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const coords = points.map((point, index) => {
    const value = point.qty ?? point.value ?? 0;
    const x = pad.l + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const y = pad.t + innerH - (value / max) * innerH;
    return { ...point, x, y, value };
  });
  const line = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords.at(-1).x.toFixed(1)},${pad.t + innerH} L${coords[0].x.toFixed(1)},${pad.t + innerH} Z`;
  const labels = coords.filter((_, index) => index === 0 || index === coords.length - 1 || index === Math.floor(coords.length / 2));
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    <line x1="${pad.l}" y1="${pad.t + innerH}" x2="${width - pad.r}" y2="${pad.t + innerH}" stroke="#e5dcd2"/>
    <path d="${area}" fill="${color}" opacity="0.14"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.4"></path>
    ${coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.4" fill="${color}"><title>${dateBR(point.date)}: ${qty(point.value)}</title></circle>`).join('')}
    ${labels.map((point) => `<text x="${point.x}" y="${height - 6}" text-anchor="middle" font-size="11" fill="#74685c">${dateBR(point.date).slice(0, 5)}</text>`).join('')}
  </svg>`;
}

export function groupedBars(points) {
  if (!points?.length) return '<p class="empty">Sem movimento no período.</p>';
  const width = 640;
  const height = 220;
  const pad = { l: 28, r: 8, t: 12, b: 28 };
  const max = scale(points.flatMap((point) => [point.entradas || 0, point.saidas || 0]));
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const slot = innerW / points.length;
  const bars = points.map((point, index) => {
    const x = pad.l + index * slot;
    const h1 = ((point.entradas || 0) / max) * innerH;
    const h2 = ((point.saidas || 0) / max) * innerH;
    return `<rect x="${x + 2}" y="${pad.t + innerH - h1}" width="${Math.max(slot / 3, 3)}" height="${h1}" rx="3" fill="#2e7d32"><title>Entradas ${qty(point.entradas)}</title></rect>
      <rect x="${x + slot / 3 + 2}" y="${pad.t + innerH - h2}" width="${Math.max(slot / 3, 3)}" height="${h2}" rx="3" fill="#ec1f28"><title>Saídas ${qty(point.saidas)}</title></rect>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}">${bars}<line x1="${pad.l}" y1="${pad.t + innerH}" x2="${width - pad.r}" y2="${pad.t + innerH}" stroke="#e5dcd2"/></svg>
    <div class="legend"><span><i style="background:#2e7d32"></i>Entradas</span><span><i style="background:#ec1f28"></i>Saídas</span></div>`;
}

export function hbars(items, color = '#ec1f28') {
  if (!items?.length) return '<p class="empty">Nada a comparar.</p>';
  const max = scale(items.map((item) => item.qty ?? item.value ?? 0));
  return items.map((item) => {
    const value = item.qty ?? item.value ?? 0;
    return `<div class="rank"><div style="flex:1"><strong>${esc(item.name || item.label)}</strong><div class="bar"><span style="width:${Math.max(4, (value / max) * 100)}%;background:${color}"></span></div></div><b>${qty(value)}</b></div>`;
  }).join('');
}

export function donut(items) {
  const rows = (items || []).filter((item) => item.qty > 0);
  if (!rows.length) return '<p class="empty">Sem saldo para distribuir.</p>';
  const colors = ['#ec1f28', '#2b2b2b', '#2e7d32', '#44546a', '#c79100', '#6b6b6b', '#c41820'];
  if (rows.length === 1) {
    return `<svg class="chart" viewBox="0 0 160 160" style="max-width:220px;margin:0 auto"><circle cx="80" cy="80" r="58" fill="${colors[0]}"/><circle cx="80" cy="80" r="34" fill="var(--paper)"/></svg><div class="legend"><span><i style="background:${colors[0]}"></i>${esc(rows[0].name)}</span></div>`;
  }
  const total = rows.reduce((sum, item) => sum + item.qty, 0);
  let angle = 0;
  const slices = rows.map((item, index) => {
    const portion = item.qty / total;
    const start = angle;
    angle += portion * Math.PI * 2;
    const large = portion > 0.5 ? 1 : 0;
    const x1 = 80 + Math.cos(start) * 58;
    const y1 = 80 + Math.sin(start) * 58;
    const x2 = 80 + Math.cos(angle) * 58;
    const y2 = 80 + Math.sin(angle) * 58;
    return `<path d="M80 80 L${x1} ${y1} A58 58 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[index % colors.length]}"><title>${esc(item.name)}: ${qty(item.qty)}</title></path>`;
  }).join('');
  const legend = rows.map((item, index) => `<span><i style="background:${colors[index % colors.length]}"></i>${esc(item.name)}</span>`).join('');
  return `<svg class="chart" viewBox="0 0 160 160" style="max-width:220px;margin:0 auto">${slices}<circle cx="80" cy="80" r="34" fill="var(--paper)"/></svg><div class="legend" style="flex-wrap:wrap;margin-top:8px">${legend}</div>`;
}
