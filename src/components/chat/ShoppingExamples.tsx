"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shoppingExamples, type ShoppingAction } from "@/application/chat/shopping-v3";

type Props = {
  disabled: boolean;
  onSelect: (text: string, action: ShoppingAction) => void;
};

export function ShoppingExamples({ disabled, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [scrollDirection, setScrollDirection] = useState<"more" | "first">();
  const title = "Explore with the assistant";

  const updateScrollControl = useCallback(() => {
    const items = list.current;
    const viewport = options.current;
    if (!items || !viewport || !toggle.current?.offsetWidth || items.scrollHeight <= viewport.clientHeight + 1) {
      setScrollDirection(undefined);
      return;
    }
    const atEnd = items.scrollTop + items.clientHeight >= items.scrollHeight - 1;
    setScrollDirection(atEnd ? "first" : "more");
  }, []);

  useEffect(() => {
    if (!expanded) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !section.current?.contains(event.target)) setExpanded(false);
    }
    const viewport = options.current;
    const items = list.current;
    if (!viewport || !items) return;
    items.scrollTop = 0;
    const observer = new ResizeObserver(updateScrollControl);
    observer.observe(viewport);
    observer.observe(items);
    items.addEventListener("scroll", updateScrollControl, { passive: true });
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      observer.disconnect();
      items.removeEventListener("scroll", updateScrollControl);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [expanded, updateScrollControl]);

  return (
    <section
      ref={section}
      className="shopping-examples"
      aria-label="Shopping examples"
      data-expanded={expanded}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded && toggle.current?.offsetWidth) {
          setExpanded(false);
          toggle.current.focus({ preventScroll: true });
        }
      }}
    >
      <h2 className="examples-heading">
        <span>{title}</span>
        <button
          ref={toggle}
          type="button"
          className="examples-toggle"
          aria-expanded={expanded}
          aria-controls="shopping-example-options"
          onClick={() => setExpanded(!expanded)}
        >
          {title}
        </button>
      </h2>
      <div ref={options} className="examples-options" id="shopping-example-options">
        <ul ref={list} className="examples-list" id="shopping-example-list">
          {shoppingExamples.map(({ label, text, action }) => (
            <li key={label}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setExpanded(false);
                  onSelect(text, action);
                }}
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
        {expanded && scrollDirection && (
          <button
            type="button"
            className="examples-scroll"
            aria-controls="shopping-example-list"
            onClick={() => {
              const items = list.current;
              if (!items) return;
              const buttons = Array.from(items.querySelectorAll<HTMLButtonElement>("li button"));
              const edge = items.getBoundingClientRect().bottom;
              const next = scrollDirection === "first"
                ? buttons[0]
                : buttons.find((button) => button.getBoundingClientRect().top >= edge - 1);
              items.scrollTop = scrollDirection === "first" ? 0 : items.scrollTop + items.clientHeight;
              updateScrollControl();
              next?.focus({ preventScroll: true });
            }}
          >
            {scrollDirection === "first" ? "Back to first examples ↑" : "More examples ↓"}
          </button>
        )}
        <p className="examples-note">
          This tab keeps your chat. Your cart stays on this device.{" "}
          <a href="https://github.com/MichalSalek/ecommerce-agent-ai">How it works ↗</a>
        </p>
      </div>
    </section>
  );
}
