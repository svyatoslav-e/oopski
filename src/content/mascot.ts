// Упсик, the Oopski mascot: a drop-shaped ghost with big eyes and two small hands.
// The drawing and its expressions live here so the character can be swapped
// without touching how the companion moves or talks.
//
// The <svg> is driven by attributes:
//   data-mood   hello | looking | pointing | asking | happy | confused | shy
//   data-eyes   open | covered   (covered: hands over the eyes, "I'm not looking")
//   data-point  left | right | none   (which hand reaches towards the target)
// and by --px / --py, the pupils' offset towards whatever it is looking at.

export const MASCOT_SIZE = 56;

export const MASCOT_SVG = `
<svg class="mascot" viewBox="0 0 64 64" width="${MASCOT_SIZE}" height="${MASCOT_SIZE}" aria-hidden="true"
     data-mood="hello" data-eyes="open" data-point="none">
  <g class="body">
    <path class="skin" d="M32 6C18 6 9 17 9 31c0 9 1.5 15 3.5 20 1.6 4 4.6 4.6 7.2 2.6 2.4-1.8 4.4-1.8 6.6 0 2.4 2 4.8 2 7.4 0 2.2-1.8 4.2-1.8 6.6 0 2.6 2 5.6 1.4 7.2-2.6 2-5 3.5-11 3.5-20C55 17 46 6 32 6z"/>
    <g class="eyes">
      <ellipse class="white" cx="23" cy="28" rx="6.5" ry="7.5"/>
      <ellipse class="white" cx="41" cy="28" rx="6.5" ry="7.5"/>
      <g class="pupils"><circle cx="23" cy="29" r="3"/><circle cx="41" cy="29" r="3"/></g>
    </g>
    <path class="mouth smile" d="M27 41q5 4 10 0"/>
    <ellipse class="mouth oh" cx="32" cy="42" rx="2.6" ry="3.2"/>
    <path class="mouth wavy" d="M26 42q3-3 6 0t6 0"/>
    <path class="mouth grin" d="M25 39q7 8 14 0z"/>
  </g>
  <circle class="hand left" cx="8" cy="42" r="5.5"/>
  <circle class="hand right" cx="56" cy="42" r="5.5"/>
</svg>`;

export const MASCOT_CSS = `
.mascot { display: block; overflow: visible; cursor: pointer; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.28)); }
.mascot .skin { fill: #f5a300; stroke: #8a5200; stroke-width: 1.5; }
.mascot .white { fill: #fff; }
.mascot .pupils { fill: #2a1b00; transform: translate(var(--px, 0px), var(--py, 0px)); transition: transform 0.2s; }
.mascot .eyes { transform-box: fill-box; transform-origin: center; animation: oopski-blink 4.6s infinite; }
.mascot .body { animation: oopski-bob 3s ease-in-out infinite; }

.mascot .mouth { display: none; fill: none; stroke: #2a1b00; stroke-width: 1.8; stroke-linecap: round; }
.mascot .mouth.oh, .mascot .mouth.grin { fill: #2a1b00; stroke: none; }
.mascot[data-mood="hello"] .smile, .mascot[data-mood="pointing"] .smile, .mascot[data-mood="shy"] .smile,
.mascot[data-mood="looking"] .oh, .mascot[data-mood="asking"] .oh,
.mascot[data-mood="confused"] .wavy, .mascot[data-mood="happy"] .grin { display: block; }

.mascot .hand {
    fill: #ffc24d; stroke: #8a5200; stroke-width: 1.5;
    transform-box: fill-box; transform-origin: center;
    transition: transform 0.35s cubic-bezier(0.3, 1.4, 0.5, 1);
}
.mascot[data-point="left"] .hand.left { transform: translate(-5px, -9px); }
.mascot[data-point="right"] .hand.right { transform: translate(5px, -9px); }
.mascot[data-eyes="covered"] .hand.left { transform: translate(15px, -13px) scale(1.45); }
.mascot[data-eyes="covered"] .hand.right { transform: translate(-15px, -13px) scale(1.45); }

.mascot[data-mood="looking"] .pupils { animation: oopski-scan 1.5s ease-in-out infinite; }
.mascot[data-mood="happy"] .body { animation: oopski-hop 0.6s ease-in-out 3; }

@keyframes oopski-blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
@keyframes oopski-bob { 50% { transform: translateY(-1.5px); } }
@keyframes oopski-scan { 0%, 100% { transform: translate(-2.6px, 0.5px); } 50% { transform: translate(2.6px, 0.5px); } }
@keyframes oopski-hop { 50% { transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) {
    .mascot .eyes, .mascot .body, .mascot .pupils { animation: none !important; }
}
`;
