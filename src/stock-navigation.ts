/** Navigation contract for the stock screen.
 * The main list never detours through legacy detail views.
 * Editors opened from the stock overview close back to the overview;
 * editors opened from a detail return to that detail.
 */
export type StockViewMode = "list"|"archive"|"create"|"detail"|"edit"|"operation"|"rule";
export type StockEditorOrigin = "list"|"detail";
export function stockBackDestination(mode:StockViewMode,origin:StockEditorOrigin):StockEditorOrigin {
 if(mode==="edit"||mode==="operation"||mode==="rule")return origin;
 return "list";
}
