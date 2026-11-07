"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StyledSelect } from "./ui/styled-select";
import type { FashionModel } from "@/lib/fashion-models";

export function FashionControls({
  container,
  models,
}: { container: HTMLElement | null; models: FashionModel[] }) {
  const [slots, setSlots] = useState<
    { select: HTMLSelectElement; target: HTMLElement }[]
  >([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const shadow = container?.shadowRoot;
    if (!shadow) return;
    const entries = [
      ...shadow.querySelectorAll<HTMLSelectElement>("select"),
    ].map((select) => {
      const target = document.createElement("div");
      target.className = "loomic-fashion-select";
      select.after(target);
      select.hidden = true;
      return { select, target };
    });
    setSlots(entries);
    const sync = () => setRevision((value) => value + 1);
    const observers = entries.map(({ select }) => {
      const observer = new MutationObserver(sync);
      observer.observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      select.addEventListener("change", sync);
      return observer;
    });
    shadow.addEventListener("loomic:select-sync", sync);
    return () => {
      observers.forEach((observer) => observer.disconnect());
      shadow.removeEventListener("loomic:select-sync", sync);
      for (const { select, target } of entries) {
        select.removeEventListener("change", sync);
        select.hidden = false;
        target.remove();
      }
    };
  }, [container]);
  return (
    <>
      {slots.map(({ select, target }) => {
        const id = select.id;
        const options = [...select.options].map((option) => {
          const model =
            id === "aiModel"
              ? models.find((item) => item.id === option.value)
              : undefined;
          return {
            value: option.value,
            label: option.text,
            note: model
              ? `${model.priceLabel} · ${model.resolution}${model.reason ? ` · ${model.reason}` : ""}`
              : undefined,
            disabled: option.disabled || model?.available === false,
          };
        });
        const label =
          select.getAttribute("aria-label") ??
          select.labels?.[0]?.textContent?.trim() ??
          select.parentElement?.querySelector("span")?.textContent?.trim() ??
          "选择配置";
        return createPortal(
          <StyledSelect
            value={select.value}
            options={options}
            disabled={select.disabled}
            aria-label={label}
            onChange={(value) => {
              select.value = value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              setRevision((current) => current + 1);
            }}
          />,
          target,
          id,
        );
      })}
    </>
  );
}
