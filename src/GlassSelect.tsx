import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** A compact keyboard-accessible select; menus inherit the workspace theme. */
export default function GlassSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      ref={root}
      className="glass-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled || !options.length}
        onClick={() => {
          setActive(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : Math.max(
                      0,
                      Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    ),
            );
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          } else if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            choose(active);
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label || label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div id={id} className="glass-options" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <div
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={active === index ? 'highlighted' : ''}
              key={option.value}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={13} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
