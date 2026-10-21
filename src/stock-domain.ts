import { occursOn, recurrenceText, type RepeatFrequency } from "./recurrence";

export const STOCK_UNITS = ["г", "кг", "мл", "л", "шт.", "таблетки", "капсулы", "порции"] as const;
export type StockUnit = typeof STOCK_UNITS[number];
export type StockTransaction = {
 id: string; type: "add"|"manual_use"|"automatic_use"|"correction";
 amount: number; direction: "in"|"out"; applied_amount: number;
 shortage: number; resulting_quantity: number; occurred_at: string;
 scheduled_for: string|null; comment: string;
};
export type StockRule = {
 id: string; enabled: boolean; amount: number; unit: string;
 frequency: Exclude<RepeatFrequency,"once"|"yearly">;
 interval_count: number; days_of_week: number[]; day_of_month: number|null;
 starts_on: string; ends_on: string|null; last_processed_on: string|null;
};
export type StockItem = {
 id: string; pet_id: string; name: string; category: string;
 current_quantity: number; reference_quantity: number;
 display_unit: StockUnit; unit: string; low_stock_threshold: number;
 note: string; notifications_enabled: boolean; legacy_food: boolean;
 rules: StockRule[]; transactions: StockTransaction[];
};
export const stockUnitBase = (unit: StockUnit): string =>
 unit === "кг" ? "г" : unit === "л" ? "мл" : unit;
export const stockUnitFactor = (unit: StockUnit): number =>
 unit === "кг" || unit === "л" ? 1000 : 1;
export function compatibleStockUnits(unit: StockUnit): StockUnit[] {
 const base=stockUnitBase(unit);
 return STOCK_UNITS.filter((u)=>stockUnitBase(u)===base);
}
export function stockAmount(amountBase: number,unit: StockUnit) {
 return Number((amountBase / stockUnitFactor(unit)).toFixed(3)).toLocaleString("ru-RU",{maximumFractionDigits:3});
}
export function stockStatus(item: StockItem): "empty"|"low"|"normal" {
 return item.current_quantity <= 0 ? "empty" :
   item.low_stock_threshold > 0 && item.current_quantity <= item.low_stock_threshold ? "low" : "normal";
}
export function activeStockRule(item: StockItem): StockRule|null {
 return item.rules.find((r)=>r.enabled)??null;
}
export function stockRuleText(rule: StockRule): string {
 return stockAmount(rule.amount, rule.unit as StockUnit)+" "+rule.unit+" · "+recurrenceText({
  date:rule.starts_on,repeat:rule.frequency,repeatInterval:rule.interval_count,
  repeatWeekdays:rule.days_of_week,repeatMonthday:rule.day_of_month??undefined,
  end:rule.ends_on??"",repeatEndType:rule.ends_on?"date":"never",
 }).toLowerCase();
}
function nextDate(s:string,add:number) {
 const d=new Date(s+"T12:00:00Z");
 d.setUTCDate(d.getUTCDate()+add);
 return d.toISOString().slice(0,10);
}
/** Predict from the next scheduled occurrence; the server already processed today. */
export function stockForecast(item:StockItem,from:string) {
 const rule=activeStockRule(item);
 if(!rule||!rule.amount||item.current_quantity<=0) return null;
 let remaining=item.current_quantity,scheduled=0;
 for(let d=1;d<=1095;d++) {
  const on=nextDate(from,d);
  if(rule.ends_on&&on>rule.ends_on)break;
  if(occursOn({date:rule.starts_on,repeat:rule.frequency,
    repeatInterval:rule.interval_count,repeatWeekdays:rule.days_of_week,
    repeatMonthday:rule.day_of_month??undefined,
    end:rule.ends_on??"",repeatEndType:rule.ends_on?"date":"never"},on)){
   scheduled++;
   remaining-=rule.amount;
   if(remaining<=0)return {days:d,date:on,occurrences:scheduled};
  }
 }
 return null;
}
export function stockProgress(item:StockItem) {
 return item.reference_quantity>0 ? Math.max(0,Math.min(100,
 Math.round(item.current_quantity/item.reference_quantity*100))) : 0;
}
