import { useId, useState, type ChangeEventHandler } from "react";
import { Clock3 } from "lucide-react";

/** Visually bounded native time picker for mobile Safari. */
export default function TrainingTimeField({
  label, name, required, disabled, value, defaultValue, onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  disabled?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}) {
  const id = useId();
  const [entered, setEntered] = useState(defaultValue ?? value ?? "");
  const shown = value ?? entered;
  return (
    <div className="field training-time-field">
      <label htmlFor={id}>{label}</label>
      <div className={`training-time-wrap${disabled ? " is-disabled" : ""}`}>
        <span className="training-time-value" aria-hidden="true">
          {shown || "Выберите время"}
        </span>
        <Clock3 className="training-time-icon" aria-hidden="true" />
        <input
          id={id} name={name} type="time" required={required} disabled={disabled}
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
