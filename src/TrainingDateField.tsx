import { useId, useState, type ChangeEventHandler } from "react";
import { CalendarDays } from "lucide-react";
import { fmt } from "./domain";

/** Fixed-width iOS-friendly date control, with a native accessible date picker.
 * The wrapper draws the border; WebKit's intrinsic date width cannot change it.
 */
export default function TrainingDateField({
  label, name, required, min, max, value, defaultValue, onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  min?: string;
  max?: string;
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}) {
  const id = useId();
  const [entered, setEntered] = useState(defaultValue ?? value ?? "");
  const shown = value ?? entered;
  return (
    <div className="field training-date-field">
      <label htmlFor={id}>{label}</label>
      <div className="training-date-wrap">
        <span className="training-date-value" aria-hidden="true">
          {shown ? fmt(shown, { day: "numeric", month: "short", year: "numeric" }) : "Выберите дату"}
        </span>
        <CalendarDays className="training-date-icon" aria-hidden="true" />
        <input
          id={id} name={name} type="date" required={required} min={min} max={max}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={(event) => {
            setEntered(event.target.value);
            onChange?.(event);
          }}
        />
      </div>
    </div>
  );
}
