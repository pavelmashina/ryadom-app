import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const files=["styles.css","stock.css","training.css","cloud.css"];
describe("All app screens use normal text casing",()=>{
 it("does not force labels or section headings into uppercase via CSS",()=>{
  for(const file of files){
   const css=readFileSync(new URL("./"+file,import.meta.url),"utf8");
   expect(css.toLowerCase(),file).not.toMatch(/text-transform\s*:\s*uppercase/);
  }
 });
});
