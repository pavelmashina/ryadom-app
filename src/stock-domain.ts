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
 archived_at?: string|null;
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
const DAY_MS=86_400_000;
const utcStamp=(s:string)=>Date.parse(s+"T00:00:00.000Z");
const toIsoDay=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const weekdays=(rule:StockRule)=>{
 const actual=new Date(utcStamp(rule.starts_on)).getUTCDay()||7;
 return [...new Set(rule.days_of_week.length?rule.days_of_week:[actual])]
  .filter(w=>w>=1&&w<=7).sort((a,b)=>a-b);
};
const lastDay=(year:number,month:number)=>
 new Date(Date.UTC(year,month,0)).getUTCDate();

/** Number of due recurrences through the inclusive date, without iterating days.
 * This avoids the old three-year ceiling for slow-use products such as shampoo.
 */
function countScheduled(rule:StockRule,through:string):number {
 if(through<rule.starts_on)return 0;
 const step=Math.max(1,Math.trunc(rule.interval_count||1));
 const days=Math.floor((utcStamp(through)-utcStamp(rule.starts_on))/DAY_MS);
 if(rule.frequency==="daily")return Math.floor(days/step)+1;
 if(rule.frequency==="weekly"){
  const startWeekday=new Date(utcStamp(rule.starts_on)).getUTCDay()||7;
  const week=Math.floor((days+startWeekday-1)/7);
  const targetWeekday=new Date(utcStamp(through)).getUTCDay()||7;
  const chosen=weekdays(rule);
  if(week===0)return chosen.filter(w=>w>=startWeekday&&w<=targetWeekday).length;
  const first=chosen.filter(w=>w>=startWeekday).length;
  const past=Math.floor((week-1)/step)*chosen.length;
  return first+past+(week%step===0?chosen.filter(w=>w<=targetWeekday).length:0);
 }
 const [sy,sm,sd]=rule.starts_on.split("-").map(Number);
 const [y,m,d]=through.split("-").map(Number);
 const monthDiff=(y-sy)*12+(m-sm);
 if(monthDiff<0)return 0;
 const firstTarget=Math.min(rule.day_of_month??sd,lastDay(sy,sm));
 const skipFirst=firstTarget<sd?1:0;
 let count=Math.floor(monthDiff/step)+1-skipFirst;
 if(monthDiff%step===0){
  const target=Math.min(rule.day_of_month??sd,lastDay(y,m));
  if(d<target)count--;
 }
 return Math.max(0,count);
}

export type StockForecast={
 days:number; date:string; occurrences:number; precision:"day"|"month";
};

/** A rough month is available only after multiple measured usages spanning a
 * full week. Never present that estimate as a specific day.
 */
function forecastFromHistory(item:StockItem,from:string):StockForecast|null {
 const uses=item.transactions
  .filter(t=>t.direction==="out"&&t.applied_amount>0&&Number.isFinite(t.applied_amount))
  .sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at));
 if(uses.length<2)return null;
 const span=Math.floor((utcStamp(uses[uses.length-1].occurred_at.slice(0,10))-
  utcStamp(uses[0].occurred_at.slice(0,10)))/DAY_MS);
 if(span<7)return null;
 const amount=uses.slice(1).reduce((sum,t)=>sum+t.applied_amount,0);
 if(amount<=0)return null;
 const days=Math.ceil(item.current_quantity*span/amount);
 const projected=utcStamp(from)+days*DAY_MS;
 if(!Number.isFinite(days)||days<0||projected>utcStamp("9999-12-31"))return null;
 return {days,date:toIsoDay(projected),occurrences:uses.length,precision:"month"};
}

/** Predict exhaustion from a scheduled rate, using bounded binary search.
 * A rule without a defined end supports multi-year predictions. */
export function stockForecast(item:StockItem,from:string):StockForecast|null {
 if(item.current_quantity<=0)return null;
 const rule=activeStockRule(item);
 if(!rule||rule.amount<=0)return forecastFromHistory(item,from);
 const required=Math.ceil(item.current_quantity/rule.amount);
 if(!Number.isSafeInteger(required)||required<=0)return null;
 const limit=rule.ends_on&&rule.ends_on<"9999-12-31"?rule.ends_on:"9999-12-31";
 if(limit<=from)return null;
 const starting=countScheduled(rule,from);
 if(countScheduled(rule,limit)-starting<required)return null;
 const first=utcStamp(from)+DAY_MS,last=utcStamp(limit);
 let low=first,high=last;
 while(low<high){
  const mid=low+Math.floor((high-low)/DAY_MS/2)*DAY_MS;
  if(countScheduled(rule,toIsoDay(mid))-starting>=required)high=mid;
  else low=mid+DAY_MS;
 }
 return {
  days:Math.round((low-utcStamp(from))/DAY_MS),date:toIsoDay(low),
  occurrences:required,precision:"day",
 };
}

/** Full date for scheduled consumption; month+year for historical estimates. */
export function stockForecastLabel(forecast:StockForecast,from:string):string {
 const [year,month,day]=forecast.date.split("-").map(Number);
 const monthText=new Intl.DateTimeFormat("ru-RU",{month:"short",timeZone:"UTC"})
  .format(new Date(Date.UTC(year,month-1,day)));
 if(forecast.precision==="month")return "до "+monthText+" "+year;
 return "до "+day+" "+monthText+(year===Number(from.slice(0,4))?"":" "+year);
}
export function stockProgress(item:StockItem) {
 return item.reference_quantity>0 ? Math.max(0,Math.min(100,
 Math.round(item.current_quantity/item.reference_quantity*100))) : 0;
}
