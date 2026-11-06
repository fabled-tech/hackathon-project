// Licensed sample assets (conditions in /workspace/fabled-pm/license_check.md). Shared by the browser (app.js) and the
// server's workspace index (workspace.mjs), so the asset tree and the viewer apply the same rules.
// The NPG.75.16 scan: verbatim credit + no-endorsement line, neutral display name (never her name as a title),
// height shown as measured from the file. File and mesh names may stay as exported.
export const LICENSED_SAMPLES = [{
  match: (m) => /NPG[._ ]?75[._ ]?16|d8c64ccc-4ebc-11ea-b77f-2e728ce88125|HelenKeller/i.test(JSON.stringify({ a: m?.asset, s: m?.source, i: m?.input?.source })),
  displayName: 'Sample asset: historical bust scan (CC0)',
  shortName: 'Historical bust scan (CC0)',
  credit: 'Helen Adams Keller by Onorio Ruotolo, 1916. National Portrait Gallery, Smithsonian Institution (NPG.75.16). 3D model via Smithsonian 3D, CC0.',
  creditUrl: 'https://3d.si.edu/object/3d/helen-adams-keller:d8c64ccc-4ebc-11ea-b77f-2e728ce88125',
  disclaimer: 'Fabled is not affiliated with or endorsed by the Smithsonian Institution.',
  heightNote: 'source units inferred',
}];
export const licensedSample = (m) => (m ? LICENSED_SAMPLES.find((x) => x.match(m)) || null : null);
