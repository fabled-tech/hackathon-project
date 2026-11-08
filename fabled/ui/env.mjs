// SculptLine environment settings. Each setting is read as SCULPTLINE_<NAME> first and falls back to the pre-rebrand
// FABLED_<NAME>, so existing shells and launch scripts keep working. An empty SCULPTLINE_<NAME> counts as unset.
export function env(name, source = process.env) {
  const v = source[`SCULPTLINE_${name}`];
  return v !== undefined && v !== '' ? v : source[`FABLED_${name}`];
}
