// PROTOTYPE. Round three: one page. The choices so far: the surveillance-feed hero, the report card for captions,
// a bento board for the capabilities, a plain 2 × 2 grid for the use cases. Earlier rounds, with their switcher,
// are at commits f4e7186 (three pages) and 8f644db (caption styles and layouts).
import { renderHero } from './hero.js';
import { renderSections } from './sections.js';

const root = document.getElementById('root');
renderHero(root); renderSections(root);
