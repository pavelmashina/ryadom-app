import { useState } from "react";
import { Button, Field, Select, Checkbox } from "./components";
import type { RepeatFrequency, RepeatEndType } from "./recurrence";
import TrainingDateField from "./TrainingDateField";

/** Shared recurrence settings UI; calendars and training planners use the same draft. */
export type RecurrenceDraft = {
  frequency: RepeatFrequency;
  interval: number;
  weekdays: number[];
  monthday: number;
  endType: RepeatEndType;
  endDate: string;
  count: number;
};

export function draftForDate(date: string): RecurrenceDraft {
  const weekday = new Date(date + "T12:00:00").getDay() || 7;
  return {
    frequency: "once",
    interval: 1,
    weekdays: [weekday],
    monthday: Number(date.slice(-2)),
    endType: "never",
    endDate: "",
    count: 10,
  };
}

export default function RecurrenceFields({
  date,
  value,
  onChange,
  allowedFrequencies = ["once","daily","weekly","monthly","yearly"],
  allowCount = true,
  flatEnd = false,
}: {
  date: string;
  value: RecurrenceDraft;
  onChange: (next: RecurrenceDraft) => void;
  allowedFrequencies?: RepeatFrequency[];
  allowCount?: boolean;
  /** Keep the end selector in the same unboxed form layout (stock consumption). */
  flatEnd?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const patch = (next: Partial<RecurrenceDraft>) => onChange({ ...value, ...next });
  return (
    <div className="recurrence-fields">
      <Select
        label="Повторение"
        value={value.frequency}
        onChange={(e) => {
          const frequency = e.target.value as RepeatFrequency;
          const weekday = new Date(date + "T12:00:00").getDay() || 7;
          patch({
            frequency,
            interval: 1,
            weekdays: [weekday],
            monthday: Number(date.slice(-2)),
          });
          if (frequency !== "once") setExpanded(true);
        }}
      >
        {allowedFrequencies.includes("once") && <option value="once">Не повторять</option>}
        {allowedFrequencies.includes("daily") && <option value="daily">Каждый день</option>}
        {allowedFrequencies.includes("weekly") && <option value="weekly">Каждую неделю</option>}
        {allowedFrequencies.includes("monthly") && <option value="monthly">Каждый месяц</option>}
        {allowedFrequencies.includes("yearly") && <option value="yearly">Каждый год</option>}
      </Select>
      {value.frequency !== "once" && (
        <>
          <Button type="button" size="sm" variant="secondary" onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Свернуть настройки" : "Настроить периодичность"}
          </Button>
          {expanded && (
            <div className={flatEnd ? "recurrence-options recurrence-options-flat-frequency" : "recurrence-options"}>
              {!flatEnd && <h3>Частота</h3>}
              <div className="fields">
                <Field
                  label="Повторять каждые"
                  type="number"
                  min={1}
                  max={366}
                  value={value.interval}
                  onChange={(e) => patch({ interval: Number(e.target.value) || 1 })}
                />
                <Select
                  label="Период"
                  value={value.frequency}
                  onChange={(e) => patch({ frequency: e.target.value as RepeatFrequency })}
                >
                  {allowedFrequencies.includes("daily") && <option value="daily">Дней</option>}
                  {allowedFrequencies.includes("weekly") && <option value="weekly">Недель</option>}
                  {allowedFrequencies.includes("monthly") && <option value="monthly">Месяцев</option>}
                  {allowedFrequencies.includes("yearly") && <option value="yearly">Лет</option>}
                </Select>
              </div>
              {value.frequency === "weekly" && (
                <div className="weekdays-picker">
                  <p>Дни недели</p>
                  <div className="weekdays-picker-row">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label, i) => (
                      <Checkbox
                        key={label}
                        label={label}
                        checked={value.weekdays.includes(i + 1)}
                        onChange={(e) =>
                          patch({
                            weekdays: e.target.checked
                              ? [...value.weekdays, i + 1].sort()
                              : value.weekdays.filter((d) => d !== i + 1),
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
              {value.frequency === "monthly" && (
                <Field
                  label="Число месяца"
                  type="number"
                  min={1}
                  max={31}
                  value={value.monthday}
                  onChange={(e) => patch({ monthday: Number(e.target.value) || 1 })}
                  hint="Если числа нет, событие переносится на последний день месяца."
                />
              )}
            </div>
          )}
          <div className={flatEnd ? "recurrence-options recurrence-options-flat-end" : "recurrence-options"}>
            <h3>{flatEnd ? "Конец диапазона" : "Диапазон"}</h3>
            <Select
              label={flatEnd ? "" : "Заканчивается"}
              aria-label={flatEnd ? "Конец диапазона" : undefined}
              value={value.endType}
              onChange={(e) => patch({ endType: e.target.value as RepeatEndType })}
            >
              <option value="never">Никогда</option>
              <option value="date">До даты</option>
              {allowCount && <option value="count">После количества повторений</option>}
            </Select>
            {value.endType === "date" && (flatEnd ? (
              <TrainingDateField
                label="Последняя дата"
                name="recurrence-end-date"
                min={date}
                value={value.endDate}
                onChange={(e) => patch({ endDate: e.target.value })}
                required
              />
            ) : (
              <Field
                label="Последняя дата"
                type="date"
                min={date}
                value={value.endDate}
                onChange={(e) => patch({ endDate: e.target.value })}
                required
              />
            ))}
            {value.endType === "count" && (
              <Field
                label="Количество повторений"
                type="number"
                min={1}
                max={10000}
                value={value.count}
                onChange={(e) => patch({ count: Number(e.target.value) || 1 })}
                required
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
