// Vercel "build" step: does NOT build anything (no pipeline/validator on a web host). It only verifies that the
// prebuilt dist/ from `npm run build:demo` is present and clean. Exit 1 otherwise.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const need = ['index.html', 'app.js', 'demo-data/demo.json', 'demo-data/manifest.json', 'demo-data/validator_report.json', 'vendor/three/build/three.module.js'];
const miss = need.filter((f) => !fs.existsSync(path.join(OUT, f)));
if (miss.length) { console.error(`dist/ is missing ${miss.join(', ')}. Run "npm run build:demo" locally first; the host cannot run the pipeline.`); process.exit(1); }
const FORBID = [/demo-data\/export\/T_[^/]+\.png$/, /(^|\/)samples\//, /test_fixtures/, /fabled_sample_head/, /CONCEPT_MOCKUP/i, /(^|\/)stub\//, /mock_pipeline/, /\.blend1?$/, /make_sample_sculpt/];
const files = fs.readdirSync(OUT, { recursive: true }).map((f) => f.split(path.sep).join('/'));
const bad = files.filter((f) => FORBID.some((re) => re.test(f)));
if (bad.length) { console.error(`forbidden files in dist: ${bad.join(', ')}`); process.exit(1); }
// demo flag: sculptline-demo, or fabled-demo in dists built before the rebrand
if (!/name="(sculptline|fabled)-demo"/.test(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'))) { console.error('dist/index.html lacks the demo flag'); process.exit(1); }
console.log(`dist OK (${files.length} entries)`);
