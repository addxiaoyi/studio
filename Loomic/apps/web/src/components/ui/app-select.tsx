"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { StyledSelect, type SelectOption } from "./styled-select";

type Props = SelectHTMLAttributes<HTMLSelectElement>;
function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return [];
    if (child.type === Fragment) return readOptions(child.props.children);
    if (child.type !== "option")
      throw new Error("AppSelect supports option children only.");
    const label =
      child.props.label ?? Children.toArray(child.props.children).join("");
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: child.props.disabled,
      },
    ];
  });
}
export function AppSelect({
  children,
  value,
  defaultValue,
  onChange,
  className,
  id,
  name,
  required,
  disabled,
  onBlur,
  ...props
}: Props) {
  const options = readOptions(children),
    [local, setLocal] = useState(
      String(defaultValue ?? options[0]?.value ?? ""),
    );
  const select = useRef<HTMLSelectElement>(null);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const [label, setLabel] = useState("");
  useLayoutEffect(() => {
    const parent = select.current?.closest("label");
    if (!parent) return;
    const originalFor = parent.getAttribute("for");
    if (!originalFor) parent.htmlFor = triggerId;
    const clone = parent.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("select,.loomic-select,button,svg")
      .forEach((node) => node.remove());
    setLabel(clone.textContent?.trim() ?? "");
    return () => {
      if (!originalFor) parent.removeAttribute("for");
    };
  }, [children, triggerId]);
  const current = value === undefined ? local : String(value);
  function change(next: string) {
    setLocal(next);
    const node = select.current;
    if (!node) return;
    node.value = next;
    onChange?.({
      target: node,
      currentTarget: node,
      type: "change",
    } as ChangeEvent<HTMLSelectElement>);
  }
  return (
    <>
      <select
        ref={select}
        value={current}
        name={name}
        disabled={disabled}
        onChange={() => {}}
        tabIndex={-1}
        aria-hidden="true"
        hidden
      >
        {children}
      </select>
      <StyledSelect
        className={className?.split(/\s+/).filter(token => /^(?:.*:)?(?:(?:min-|max-)?w-|basis-|flex-)/.test(token)).join(" ")}
        value={current}
        options={options}
        onChange={change}
        id={triggerId}
        required={required}
        disabled={disabled}
        triggerClassName={className}
        aria-label={props["aria-label"] || label || undefined}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        onBlur={
          onBlur
            ? (event) =>
                onBlur({
                  target: select.current,
                  currentTarget: select.current,
                  type: "blur",
                  relatedTarget: event.relatedTarget,
                } as React.FocusEvent<HTMLSelectElement>)
            : undefined
        }
      />
    </>
  );
}
