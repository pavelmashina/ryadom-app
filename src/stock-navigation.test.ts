import { describe, expect, it } from "vitest";
import { stockBackDestination, type StockEditorOrigin, type StockViewMode } from "./stock-navigation";

describe("Stock screen navigation", () => {
 it("the main list, creation and detail always return to the main stock list", () => {
  for(const view of ["list","create","detail"] as StockViewMode[]){
   expect(stockBackDestination(view,"detail"),view).toBe("list");
   expect(stockBackDestination(view,"list"),view).toBe("list");
  }
 });
 it("edit, consumption rule and quantity operations remember where the user came from", () => {
  for(const view of ["edit","operation","rule"] as StockViewMode[]){
   for(const origin of ["detail","list"] as StockEditorOrigin[]){
    expect(stockBackDestination(view,origin),view+" "+origin).toBe(origin);
   }
  }
 });
 it("full journeys contain no stale detail screen or navigation loop", () => {
  // Main overview > gear > usage editor > back to overview.
  expect(stockBackDestination("rule","list")).toBe("list");
  expect(stockBackDestination("operation","list")).toBe("list");
  // Main overview > item detail > edit item > detail > overview.
  expect(stockBackDestination("edit","detail")).toBe("detail");
  expect(stockBackDestination("detail","detail")).toBe("list");
  // New item creation and existing stock replenishment are in the same overview.
  expect(stockBackDestination("create","detail")).toBe("list");
 });
});
