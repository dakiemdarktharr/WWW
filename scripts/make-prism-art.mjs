import fs from 'node:fs';
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, n) => a.map((v) => v * n);
const norm = (a) => mul(a, 1 / Math.hypot(...a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function center(t) {
  return [
    (2 + 0.57 * Math.cos(3 * t)) * Math.cos(2 * t),
    (2 + 0.57 * Math.cos(3 * t)) * Math.sin(2 * t),
    0.85 * Math.sin(3 * t),
  ];
}
function rotate([x, y, z]) {
  const a = 0.7,
    b = -0.44;
  const yy = y * Math.cos(a) - z * Math.sin(a),
    zz = y * Math.sin(a) + z * Math.cos(a);
  return [x * Math.cos(b) - yy * Math.sin(b), x * Math.sin(b) + yy * Math.cos(b), zz];
}
function project(p) {
  const [x, y, z] = rotate(p),
    f = 1 + z * 0.07;
  return [500 + x * 132 * f, 460 + y * 132 * f, z];
}
const rings = [];
for (let i = 0; i < 124; i++) {
  const t = (i / 124) * Math.PI * 2,
    c = center(t),
    d = norm(add(center(t + 0.001), mul(c, -1))),
    n = norm(cross(d, [0, 0, 1])),
    b = cross(d, n);
  const pts = [];
  for (let j = 0; j <= 60; j++) {
    const a = (j / 60) * Math.PI * 2;
    pts.push(project(add(c, add(mul(n, 0.52 * Math.cos(a)), mul(b, 0.52 * Math.sin(a))))));
  }
  const path =
    pts.map((p, j) => (j ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ') + 'Z';
  rings.push({ z: project(c)[2], path, i });
}
rings.sort((a, b) => a.z - b.z);
const paths = rings
  .map(
    ({ path, i }) =>
      `<path d="${path}" fill="url(#body)" fill-opacity=".13" stroke="url(#edge)" stroke-width="${i % 5 === 0 ? 3.7 : 2.3}"/><path d="${path}" fill="none" stroke="white" stroke-opacity=".48" stroke-width=".65" transform="translate(-1 -1)"/>`,
  )
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><defs><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".17" stop-color="#b7a1e8"/><stop offset=".3" stop-color="#3d344d"/><stop offset=".37" stop-color="#fff"/><stop offset=".48" stop-color="#ddd1fc"/><stop offset=".61" stop-color="#8161b5"/><stop offset=".69" stop-color="#f4ffca"/><stop offset=".76" stop-color="#c2df79"/><stop offset=".85" stop-color="#302b38"/><stop offset=".92" stop-color="#b7a1e8"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="body" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#c6b3f1"/><stop offset="1" stop-color="#ebf6d7"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="24"/></filter></defs><ellipse cx="510" cy="870" rx="245" ry="27" fill="#514361" opacity=".16" filter="url(#shadow)"/>${paths}</svg>`;
fs.mkdirSync('public/art', { recursive: true });
fs.writeFileSync('public/art/kivuno-prism.svg', svg);
