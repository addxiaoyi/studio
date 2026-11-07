"use client";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import "./select.css";

export type SelectOption = {
  value: string;
  label: string;
  note?: string | undefined;
  badge?: string | undefined;
  disabled?: boolean | undefined;
};
export type StyledSelectProps = {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  disabled?: boolean | undefined;
  className?: string | undefined;
  triggerClassName?: string | undefined;
  placeholder?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-describedby"?: string | undefined;
  onBlur?: React.FocusEventHandler<HTMLButtonElement> | undefined;
};
export function StyledSelect({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  triggerClassName = "",
  placeholder = "请选择",
  id,
  name,
  required,
  onBlur,
  ...aria
}: StyledSelectProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const active = options.find((option) => option.value === value);
  function opened(open: boolean) {
    if (open) {
      const node = trigger.current;
      setPortal(node?.closest<HTMLElement>("dialog[open], [data-select-portal]") ?? null);
    }
  }
  return (
    <div className={`loomic-select ${className}`}>
      <Select.Root
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        items={options}
        disabled={disabled || !options.length}
        name={name}
        required={required}
        onOpenChange={opened}
      >
        <Select.Trigger
          ref={trigger}
          id={id}
          {...aria}
          onBlur={onBlur}
          className={`loomic-select-trigger ${triggerClassName}`}
        >
          <Select.Value
            className="loomic-select-value"
            placeholder={placeholder}
          >
            {active?.label ?? placeholder}
          </Select.Value>
          {active?.badge && (
            <span className="loomic-select-badge">{active.badge}</span>
          )}
          <Select.Icon className="loomic-select-icon">
            <ChevronDown aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal container={portal ?? undefined}>
          <Select.Positioner
            sideOffset={6}
            align="start"
            alignItemWithTrigger={false}
            collisionPadding={12}
            className="loomic-select-positioner"
          >
            <Select.Popup
              className="loomic-select-popup"
              aria-label={aria["aria-label"]}
            >
              <Select.ScrollUpArrow className="loomic-select-scroll">
                <ChevronUp aria-hidden="true" />
              </Select.ScrollUpArrow>
              <Select.List
                className="loomic-select-list"
                aria-label={aria["aria-label"]}
              >
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="loomic-select-option"
                  >
                    <span className="loomic-select-copy">
                      <Select.ItemText>{option.label}</Select.ItemText>
                      {option.note && (
                        <span className="loomic-select-note">
                          {option.note}
                        </span>
                      )}
                    </span>
                    {option.badge && (
                      <span className="loomic-select-badge">
                        {option.badge}
                      </span>
                    )}
                    <Select.ItemIndicator className="loomic-select-check">
                      <Check aria-hidden="true" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
              <Select.ScrollDownArrow className="loomic-select-scroll">
                <ChevronDown aria-hidden="true" />
              </Select.ScrollDownArrow>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
