/** Visible label for always-on desk chips. Stored method stays on data-method. */
export function chipMethodLabel(method: string): string {
  return method === 'judge_grounded' ? 'memo_grounded' : method;
}
