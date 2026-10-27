import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & {
  name: string;
  value?: string | number;
};

export function TextInput({ name, value = "", placeholder = "", type = "text", ...rest }: TextInputProps) {
  const aria = rest["aria-label"] ?? (placeholder || name);
  return <input {...rest} name={name} type={type} placeholder={placeholder} defaultValue={value} aria-label={aria} />;
}

type SelectOption = string | number | readonly [string | number, string | number];

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue"> & {
  name: string;
  value?: string | number;
  options: readonly SelectOption[];
};

export function Select({ name, options, value, ...rest }: SelectProps) {
  const aria = rest["aria-label"] ?? name;
  return (
    <select {...rest} name={name} aria-label={aria} defaultValue={value === undefined ? undefined : String(value)}>
      {options.map(option => {
        const [optionValue, label] = Array.isArray(option) ? option : [option, option];
        const text = String(optionValue);
        return (
          <option key={text} value={text}>
            {String(label)}
          </option>
        );
      })}
    </select>
  );
}
