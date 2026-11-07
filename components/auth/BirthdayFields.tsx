"use client";

import { SelectField, TextField } from "./fields";

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Birthday = { month: string; day: string; year: string };

export const emptyBirthday: Birthday = { month: "", day: "", year: "" };

/** "YYYY-MM-DD", or "" while a part is missing. */
export function birthdayValue(b: Birthday): string {
  if (!b.month || !b.day || !b.year) return "";
  return `${b.year.padStart(4, "0")}-${b.month.padStart(2, "0")}-${b.day.padStart(2, "0")}`;
}

/** Month, day and year side by side, as on the 2019 Google sign up page. */
export function BirthdayFields({
  value,
  onChange,
  disabled,
}: {
  value: Birthday;
  onChange: (b: Birthday) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Birthday</legend>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
        <SelectField
          label="Month"
          value={value.month}
          disabled={disabled}
          required
          onChange={(e) => onChange({ ...value, month: e.target.value })}
        >
          <option value="" disabled>
            Month
          </option>
          {months.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Day"
          inputMode="numeric"
          maxLength={2}
          value={value.day}
          disabled={disabled}
          required
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "") })}
        />
        <TextField
          label="Year"
          inputMode="numeric"
          maxLength={4}
          value={value.year}
          disabled={disabled}
          required
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })}
        />
      </div>
    </fieldset>
  );
}
